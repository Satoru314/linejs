import type { CommandSpec } from "../command.ts";
import type { Chat, Client } from "@evex-dev/linejs";
import { UsageError } from "../errors.ts";
import { readFileAsBlob } from "../files.ts";
import { serialize } from "../output.ts";
import { withClient } from "../session.ts";
import {
	chatSummary,
	type ContactProfile,
	fetchContactProfiles,
	fetchTalkHistory,
	isUserMid,
	limitOption,
	RAW_OPTION,
	requireJsonObject,
	requireStringRecord,
	resolveContentType,
	talkMessageSummary,
	userChatSummary,
} from "./shared.ts";

export function summarizeChats(
	chats: readonly Chat[],
	includeRaw: boolean,
	filter?: string,
): Array<Record<string, unknown>> {
	const normalized = filter?.toLowerCase();
	return chats
		.map((chat) => chatSummary(chat, includeRaw))
		.filter(
			(row) =>
				!normalized ||
				String(row.name ?? "")
					.toLowerCase()
					.includes(normalized),
		);
}

const listCommand: CommandSpec = {
	name: "chats list",
	summary: "List group and room chats.",
	category: "Chats",
	options: [
		{ name: "name", type: "string", valueName: "text", description: "Filter by chat name." },
		RAW_OPTION,
	],
	examples: ["line chats list", "line chats list --json", "line chats list --raw"],
	auth: true,
	readOnly: true,
	async run(context) {
		return await withClient(context, async ({ client }) => {
			const chats = await client.fetchJoinedChats();
			return { chats: summarizeChats(chats, context.getBool("raw"), context.getString("name")) };
		});
	},
	format(value) {
		const chats = (value as { chats: Array<Record<string, unknown>> }).chats;
		if (!chats.length) return "No chats.";
		const lines = ["MID  NAME  TYPE"];
		for (const chat of chats) {
			lines.push(
				`${String(chat.mid ?? "")}  ${String(chat.name ?? "")}  ${String(chat.type ?? "")}`,
			);
		}
		return lines.join("\n");
	},
};

export type RecentChatKind = "USER" | "BOT" | "GROUP" | "ROOM";

export interface RecentChat {
	mid: string;
	kind: RecentChatKind;
	name: string;
	lastMessageTime: string | null;
	unreadCount: number;
	statusMessage?: string;
}

function int64Value(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
	return undefined;
}

function isoTime(milliseconds: number | undefined): string | null {
	if (milliseconds === undefined || !Number.isFinite(milliseconds)) return null;
	return new Date(milliseconds).toISOString();
}

/**
 * Build the recent-inbox list from `getMessageBoxes`. User mids are resolved
 * in one bulk contact lookup and group/room names in one bulk chat lookup.
 */
export async function fetchRecentChats(client: Client, limit: number): Promise<RecentChat[]> {
	const response = await client.base.talk.getMessageBoxes({
		messageBoxListRequest: {
			activeOnly: true,
			withUnreadCount: true,
			messageBoxCountLimit: limit,
		},
	});
	const boxes = response.messageBoxes ?? [];
	const userMids = boxes.map((box) => box.id).filter(isUserMid);
	const chatMids = boxes
		.map((box) => box.id)
		.filter((mid) => mid.startsWith("c") || mid.startsWith("r"));

	const userProfiles: Map<string, ContactProfile> = userMids.length
		? await fetchContactProfiles(client, userMids)
		: new Map();
	const chatNames = new Map<string, string>();
	if (chatMids.length) {
		const { chats } = await client.base.talk.getChats({ chatMids });
		for (const chat of chats) chatNames.set(chat.chatMid, chat.chatName);
	}

	const rows = boxes.flatMap((box): Array<RecentChat & { sortTime: number }> => {
		const mid = box.id;
		const prefix = mid[0];
		const profile = userProfiles.get(mid);
		let kind: RecentChatKind;
		if (prefix === "u") kind = profile?.isBot ? "BOT" : "USER";
		else if (prefix === "c") kind = "GROUP";
		else if (prefix === "r") kind = "ROOM";
		else return [];

		const sortTime = int64Value(box.lastDeliveredMessageId?.deliveredTime) ?? 0;
		return [
			{
				mid,
				kind,
				name: profile?.displayName ?? chatNames.get(mid) ?? mid,
				lastMessageTime: isoTime(sortTime || undefined),
				unreadCount: int64Value(box.unreadCount) ?? 0,
				...(kind === "BOT" && profile?.statusMessage
					? { statusMessage: profile.statusMessage }
					: {}),
				sortTime,
			},
		];
	});

	return rows
		.sort((a, b) => b.sortTime - a.sortTime)
		.slice(0, limit)
		.map(({ sortTime: _sortTime, ...row }) => row);
}

const recentCommand: CommandSpec = {
	name: "chats recent",
	summary: "List recent inbox chats, including 1:1 chats with official accounts (BOT).",
	category: "Chats",
	options: [limitOption(20)],
	examples: ["line chats recent", "line chats recent -n 50 --json"],
	auth: true,
	readOnly: true,
	async run(context) {
		const limit = context.getNumber("limit") ?? 20;
		if (limit <= 0) throw new UsageError("--limit must be positive");
		return await withClient(context, async ({ client }) => {
			return { chats: await fetchRecentChats(client, limit) };
		});
	},
	format(value) {
		const chats = (value as { chats: RecentChat[] }).chats;
		if (!chats.length) return "No recent chats.";
		const lines = ["MID  KIND  NAME  UNREAD  LAST"];
		for (const chat of chats) {
			lines.push(
				`${chat.mid}  ${chat.kind}  ${chat.name}  ${String(chat.unreadCount)}  ${chat.lastMessageTime ?? ""}`,
			);
		}
		return lines.join("\n");
	},
};

const getCommand: CommandSpec = {
	name: "chats get",
	summary: "Show one chat and its members.",
	category: "Chats",
	args: [{ name: "chatMid", description: "Chat MID (c... or r...).", required: true }],
	options: [RAW_OPTION],
	examples: ["line chats get cxxxxxxxx", "line chats get cxxxxxxxx --raw"],
	auth: true,
	readOnly: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		return await withClient(context, async ({ client }) => {
			const chat = await client.getChat(chatMid);
			return chatSummary(chat, context.getBool("raw"));
		});
	},
	format(value) {
		const chat = value as Record<string, unknown>;
		const raw = (chat.raw ?? {}) as Record<string, unknown>;
		const lines = [
			`MID:      ${String(chat.mid ?? "")}`,
			`Name:     ${String(chat.name ?? "")}`,
			`Type:     ${String(chat.type ?? "")}`,
		];
		if (Array.isArray(raw.members)) {
			lines.push(`Members:  ${raw.members.length}`);
		} else if (chat.memberCount !== undefined) {
			lines.push(`Members:  ${String(chat.memberCount)}`);
		}
		if (Array.isArray(raw.invitees)) lines.push(`Invitees: ${raw.invitees.length}`);
		return lines.join("\n");
	},
};

const messagesCommand: CommandSpec = {
	name: "chats messages",
	summary: "Fetch recent messages from a chat.",
	category: "Chats",
	args: [
		{ name: "chatMid", description: "Chat MID (c..., r..., or u... for 1:1).", required: true },
	],
	options: [limitOption(20), RAW_OPTION],
	examples: [
		"line chats messages cxxxxxxxx -n 50",
		"line chats messages cxxxxxxxx --json",
		"line chats messages uxxxxxxxx --raw",
	],
	auth: true,
	readOnly: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		const limit = context.getNumber("limit") ?? 20;
		const includeRaw = context.getBool("raw");
		if (limit <= 0) throw new UsageError("--limit must be positive");
		return await withClient(context, async ({ client }) => {
			const history = await fetchTalkHistory(client, chatMid, limit);
			const messages = history.messages.map((message) => talkMessageSummary(message, includeRaw));
			if (isUserMid(chatMid)) {
				return {
					chat: userChatSummary(chatMid),
					messages,
					historyAvailable: history.historyAvailable,
				};
			}
			const chat = await client.getChat(chatMid);
			return {
				chat: chatSummary(chat, includeRaw),
				messages,
				historyAvailable: history.historyAvailable,
			};
		});
	},
	format(value) {
		const result = value as {
			chat: { name?: string };
			messages: Array<Record<string, unknown>>;
		};
		if (!result.messages.length) return `No messages in ${result.chat.name ?? "chat"}.`;
		return result.messages
			.map(
				(message) =>
					`[${String(message.createdTime ?? "")}] ${String(message.from ?? "")}: ${String(
						message.text ?? `(${String(message.contentType ?? "message")})`,
					)}  (${String(message.id ?? "")})`,
			)
			.join("\n");
	},
};

const sendCommand: CommandSpec = {
	name: "chats send",
	summary: "Send a text message to a user or chat.",
	category: "Chats",
	args: [
		{ name: "to", description: "Target MID (u... user, c... group, r... room).", required: true },
		{ name: "text", description: "Message text (or use --text).", required: false, variadic: true },
	],
	options: [
		{ name: "text", type: "string", valueName: "text", description: "Message text." },
		{
			name: "e2ee",
			type: "boolean",
			description: "Use end-to-end encryption (default). Use --no-e2ee to disable.",
		},
		{
			name: "reply-to",
			type: "string",
			valueName: "messageId",
			description: "Related message id (reply).",
		},
		{
			name: "content-type",
			type: "string",
			valueName: "type",
			description: "LINE ContentType (default NONE).",
		},
		{
			name: "metadata",
			type: "string",
			valueName: "json",
			description: "contentMetadata JSON object.",
		},
		{ name: "location", type: "string", valueName: "json", description: "Location JSON object." },
		{
			name: "chunk",
			type: "array",
			valueName: "chunk",
			description: "Pre-encrypted chunk (repeatable; advanced).",
		},
	],
	examples: [
		"line chats send uxxxxxxxx 'Hello from linejs'",
		'line chats send cxxxxxxxx --text "Hi" --no-e2ee',
		'line chats send cxxxxxxxx "reply" --reply-to 123456789',
	],
	auth: true,
	async run(context) {
		const to = context.requireArg(0, "to");
		const text = context.getString("text") ?? context.rest(1);
		const metadata = requireStringRecord(context, "metadata");
		const location = requireJsonObject<Record<string, unknown>>(context, "location");
		const chunks = context.getArray("chunk");
		const contentType = resolveContentType(context.getString("content-type"));
		if (!text && !metadata && !location && !chunks.length) {
			throw new UsageError("Nothing to send. Pass message text or content options.");
		}
		return await withClient(context, async ({ base }) => {
			const message = await base.talk.sendMessage({
				to,
				text: text || undefined,
				e2ee: context.getBool("e2ee", true),
				contentType: contentType as never,
				contentMetadata: metadata,
				relatedMessageId: context.getString("reply-to"),
				location: location as never,
				chunks: chunks.length ? chunks : undefined,
			});
			return { ok: true, message };
		});
	},
	format(value) {
		const message = (value as { message: Record<string, unknown> }).message;
		return `Sent message ${String(message.id ?? "")} to ${String(message.to ?? "")}`;
	},
};

const sendMediaCommand: CommandSpec = {
	name: "chats send-media",
	summary: "Send an E2EE image, video, audio, file, or GIF to a user or chat.",
	category: "Chats",
	args: [
		{ name: "to", description: "Target MID (u... or c...).", required: true },
		{ name: "file", description: "File to upload.", required: true },
	],
	options: [
		{
			name: "type",
			type: "string",
			valueName: "type",
			choices: ["image", "video", "audio", "file", "gif"],
			description: "Media type. Defaults from the file extension.",
		},
		{ name: "preview", type: "string", valueName: "path", description: "Preview/thumbnail image." },
		{
			name: "duration-ms",
			type: "number",
			valueName: "ms",
			description: "Video/audio duration in milliseconds.",
		},
		{ name: "filename", type: "string", valueName: "name", description: "Display filename." },
	],
	examples: [
		"line chats send-media uxxxxxxxx ./photo.jpg",
		"line chats send-media cxxxxxxxx ./clip.mp4 --type video --duration-ms 12000",
	],
	auth: true,
	async run(context) {
		const to = context.requireArg(0, "to");
		if (!(to.startsWith("u") || to.startsWith("c"))) {
			throw new UsageError("E2EE media can only be sent to u... or c... MIDs");
		}
		const file = await readFileAsBlob(context.requireArg(1, "file"), context.settings.cwd);
		const preview = context.getString("preview")
			? await readFileAsBlob(context.getString("preview")!, context.settings.cwd)
			: undefined;
		const type = (context.getString("type") ??
			(file.blob.type.startsWith("video/")
				? "video"
				: file.blob.type.startsWith("audio/")
					? "audio"
					: file.blob.type === "image/gif"
						? "gif"
						: file.blob.type.startsWith("image/")
							? "image"
							: "file")) as "image" | "video" | "audio" | "file" | "gif";
		return await withClient(context, async ({ base }) => {
			const message = await base.obs.uploadMediaByE2EE({
				data: file.blob,
				oType: type,
				to,
				filename: context.getString("filename") ?? file.filename,
				preview: preview?.blob,
				durationMs: context.getNumber("duration-ms"),
			});
			return { ok: true, message, type };
		});
	},
	format(value) {
		const result = value as { message: Record<string, unknown>; type: string };
		return `Sent ${result.type} as message ${String(result.message.id ?? "")}`;
	},
};

const compactCommand: CommandSpec = {
	name: "chats compact",
	summary: "Send a compact (/CA5 or /ECA5) text message.",
	category: "Chats",
	args: [
		{ name: "to", description: "Target MID.", required: true },
		{ name: "text", description: "Message text.", required: false, variadic: true },
	],
	options: [{ name: "text", type: "string", valueName: "text", description: "Message text." }],
	examples: ["line chats compact uxxxxxxxx 'hello'"],
	auth: true,
	async run(context) {
		const to = context.requireArg(0, "to");
		const text = context.getString("text") ?? context.rest(1);
		if (!text) throw new UsageError("Missing message text");
		return await withClient(context, async ({ client }) => {
			const response = await client.sendCompactMessage(to, text);
			return { ok: true, response };
		});
	},
	format(value) {
		return `Sent compact message: ${JSON.stringify(serialize(value))}`;
	},
};

const createCommand: CommandSpec = {
	name: "chats create",
	summary: "Create a group or room chat.",
	category: "Chats",
	options: [
		{ name: "mid", type: "array", valueName: "mid", description: "Target user MID (repeatable)." },
		{ name: "name", type: "string", valueName: "name", description: "Chat name." },
		{
			name: "type",
			type: "string",
			valueName: "type",
			choices: ["GROUP", "ROOM"],
			description: "Chat type (default GROUP).",
		},
		{
			name: "picture-path",
			type: "string",
			valueName: "path",
			description: "Chat picture OBS path.",
		},
	],
	examples: ["line chats create --mid uxxxx --mid uyyyy --name 'Project'"],
	auth: true,
	async run(context) {
		const mids = context.getArray("mid");
		if (!mids.length) throw new UsageError("Pass at least one --mid");
		const type = context.getString("type") ?? "GROUP";
		return await withClient(context, async ({ base }) => {
			const result = await base.talk.createChat({
				request: {
					reqSeq: await base.getReqseq(),
					targetUserMids: mids,
					type: type as never,
					name: context.getString("name"),
					picturePath: context.getString("picture-path"),
				},
			} as never);
			return { ok: true, result };
		});
	},
	format(value) {
		const result = (value as { result: Record<string, unknown> }).result;
		return `Created chat ${String(result.chatMid ?? JSON.stringify(serialize(result)))}`;
	},
};

const inviteCommand: CommandSpec = {
	name: "chats invite",
	summary: "Invite users to a chat.",
	category: "Chats",
	args: [
		{ name: "chatMid", description: "Chat MID.", required: true },
		{ name: "mid", description: "User MID(s) to invite.", required: true, variadic: true },
	],
	examples: ["line chats invite cxxxxxxxx uxxxx uyyyy"],
	auth: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		const mids = context.positionals.slice(1);
		if (!mids.length) throw new UsageError("Pass at least one user MID");
		return await withClient(context, async ({ base }) => {
			const result = await base.talk.inviteIntoChat({ chatMid, targetUserMids: mids });
			return { ok: true, chatMid, mids, result };
		});
	},
	format(value) {
		const result = value as { chatMid: string; mids: string[] };
		return `Invited ${result.mids.join(", ")} to ${result.chatMid}`;
	},
};

const kickCommand: CommandSpec = {
	name: "chats kick",
	summary: "Remove a user from a chat.",
	category: "Chats",
	args: [
		{ name: "chatMid", description: "Chat MID.", required: true },
		{ name: "mid", description: "User MID to remove.", required: true },
	],
	examples: ["line chats kick cxxxxxxxx uxxxx"],
	auth: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		const mid = context.requireArg(1, "mid");
		return await withClient(context, async ({ base }) => {
			const result = await base.talk.deleteOtherFromChat({
				request: {
					chatMid,
					targetUserMids: [mid],
					reqSeq: await base.getReqseq(),
				},
			});
			return { ok: true, chatMid, mid, result };
		});
	},
	format(value) {
		const result = value as { chatMid: string; mid: string };
		return `Removed ${result.mid} from ${result.chatMid}`;
	},
};

const leaveCommand: CommandSpec = {
	name: "chats leave",
	summary: "Leave a chat.",
	category: "Chats",
	args: [{ name: "chatMid", description: "Chat MID.", required: true }],
	options: [{ name: "yes", type: "boolean", description: "Skip the confirmation prompt." }],
	examples: ["line chats leave cxxxxxxxx --yes"],
	auth: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		if (!context.getBool("yes")) {
			throw new UsageError("Pass --yes to confirm leaving the chat");
		}
		return await withClient(context, async ({ base }) => {
			const result = await base.talk.deleteSelfFromChat({
				request: { chatMid, reqSeq: await base.getReqseq() },
			});
			return { ok: true, chatMid, result };
		});
	},
	format(value) {
		return `Left ${(value as { chatMid: string }).chatMid}`;
	},
};

const renameCommand: CommandSpec = {
	name: "chats rename",
	summary: "Rename a chat.",
	category: "Chats",
	args: [
		{ name: "chatMid", description: "Chat MID.", required: true },
		{ name: "name", description: "New chat name.", required: true },
	],
	examples: ["line chats rename cxxxxxxxx 'New name'"],
	auth: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		const name = context.rest(1);
		if (!name) throw new UsageError("Missing chat name");
		return await withClient(context, async ({ base }) => {
			const result = await base.talk.updateChat({
				request: {
					updatedAttribute: "NAME",
					chat: { chatMid, chatName: name },
					reqSeq: await base.getReqseq(),
				},
			});
			return { ok: true, chatMid, name, result };
		});
	},
	format(value) {
		const result = value as { chatMid: string; name: string };
		return `Renamed ${result.chatMid} to ${result.name}`;
	},
};

const bgmGetCommand: CommandSpec = {
	name: "chats bgm get",
	summary: "Show the BGM set on a chat.",
	category: "Chats",
	args: [{ name: "chatMid", description: "Chat MID.", required: true }],
	examples: ["line chats bgm get cxxxxxxxx"],
	auth: true,
	readOnly: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		return await withClient(context, async ({ client }) => {
			const chat = await client.getChat(chatMid);
			const bgm = await chat.getBgm();
			return { chatMid, bgm: bgm ?? null };
		});
	},
	format(value) {
		const result = value as { chatMid: string; bgm: Record<string, unknown> | null };
		return result.bgm
			? `BGM for ${result.chatMid}: ${String(result.bgm.chatRoomBGMInfo ?? "")}`
			: `No BGM set on ${result.chatMid}.`;
	},
};

const bgmSetCommand: CommandSpec = {
	name: "chats bgm set",
	summary: "Set or clear the BGM on a chat.",
	category: "Chats",
	args: [
		{ name: "chatMid", description: "Chat MID.", required: true },
		{ name: "info", description: "BGM info (LINE MUSIC id); omit with --clear.", required: false },
	],
	options: [{ name: "clear", type: "boolean", description: "Clear the BGM." }],
	examples: ["line chats bgm set cxxxxxxxx 'bgm-info'", "line chats bgm set cxxxxxxxx --clear"],
	auth: true,
	async run(context) {
		const chatMid = context.requireArg(0, "chatMid");
		const clear = context.getBool("clear");
		const info = context.arg(1);
		if (!clear && !info) throw new UsageError("Pass BGM info or --clear");
		return await withClient(context, async ({ client }) => {
			const chat = await client.getChat(chatMid);
			const bgm = await chat.setBgm(clear ? null : info!);
			return { ok: true, chatMid, bgm };
		});
	},
	format(value) {
		return `Updated BGM for ${(value as { chatMid: string }).chatMid}`;
	},
};

export const chatsCommands: CommandSpec[] = [
	listCommand,
	recentCommand,
	getCommand,
	messagesCommand,
	sendCommand,
	sendMediaCommand,
	compactCommand,
	createCommand,
	inviteCommand,
	kickCommand,
	leaveCommand,
	renameCommand,
	bgmGetCommand,
	bgmSetCommand,
];

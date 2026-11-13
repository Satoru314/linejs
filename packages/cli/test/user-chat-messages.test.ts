import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
	fetchTalkHistory,
	fetchTalkMessages,
	fetchUserTalkMessages,
	isUserMid,
	userChatSummary,
} from "../src/commands/shared.ts";
import { CliError } from "../src/errors.ts";
import type { Client } from "@evex-dev/linejs";

const RAW_MESSAGES = [
	{
		id: "111",
		deliveredTime: 200,
		contentType: "NONE",
		contentMetadata: {},
		text: "hello",
	},
	{
		id: "222",
		deliveredTime: 201,
		contentType: "NONE",
		contentMetadata: {},
		text: "world",
	},
];

function historyClient(options: { messages?: unknown[]; error?: Error } = {}) {
	const calls: string[] = [];
	const client = {
		getChat: async () => {
			calls.push("getChat");
			throw new Error("getChat must not be called");
		},
		base: {
			talk: {
				async getMessageBoxes() {
					calls.push("getMessageBoxes");
					throw new Error("getMessageBoxes must not be called");
				},
				async getRecentMessagesV2({
					messageBoxId,
					messagesCount,
				}: {
					messageBoxId: string;
					messagesCount: number;
				}) {
					calls.push(`getRecentMessagesV2:${messageBoxId}:${messagesCount}`);
					if (options.error) throw options.error;
					return options.messages ?? RAW_MESSAGES;
				},
			},
		},
	} as never as Client;
	return { client, calls };
}

test("isUserMid only matches u... mids", () => {
	assert.equal(isUserMid("u123"), true);
	assert.equal(isUserMid("c123"), false);
	assert.equal(isUserMid("r123"), false);
	assert.equal(isUserMid("m123"), false);
});

test("userChatSummary reports a USER chat", () => {
	assert.deepEqual(userChatSummary("u123"), { mid: "u123", type: "USER" });
});

test("1:1 history uses getRecentMessagesV2 without reading the inbox", async () => {
	const { client, calls } = historyClient();
	const history = await fetchTalkHistory(client, "u-user", 10);
	assert.deepEqual(calls, ["getRecentMessagesV2:u-user:10"]);
	assert.equal(history.historyAvailable, true);
	assert.equal(history.messages.length, 2);
	assert.equal(history.messages[0]!.raw.id, "111");
	assert.equal(history.messages[1]!.raw.id, "222");
});

test("empty 1:1 history is not an error and reports historyAvailable false", async () => {
	const { client } = historyClient({ messages: [] });
	const history = await fetchTalkHistory(client, "u-quiet", 10);
	assert.deepEqual(history.messages, []);
	assert.equal(history.historyAvailable, false);
});

test("API errors are preserved as CliError without an open-the-app hint", async () => {
	const { client } = historyClient({ error: new Error("Message box u-missing was not found") });
	await assert.rejects(
		() => fetchTalkHistory(client, "u-missing", 10),
		(error) =>
			error instanceof CliError &&
			error.code === "LINEJS_ERROR" &&
			error.message === "Message box u-missing was not found" &&
			!String((error.details as { hint?: string } | undefined)?.hint ?? "").includes(
				"official client",
			),
	);
});

test("fetchUserTalkMessages and fetchTalkMessages keep their array API", async () => {
	const { client } = historyClient();
	const userMessages = await fetchUserTalkMessages(client, "u-user", 10);
	assert.equal(userMessages.length, 2);
	const groupMessages = await fetchTalkMessages(client, "c-group", 5);
	assert.equal(groupMessages.length, 2);
});

test("group and room mids use the same getRecentMessagesV2 path", async () => {
	const group = historyClient();
	await fetchTalkHistory(group.client, "c-group", 5);
	assert.deepEqual(group.calls, ["getRecentMessagesV2:c-group:5"]);

	const room = historyClient();
	await fetchTalkHistory(room.client, "r-room", 50);
	assert.deepEqual(room.calls, ["getRecentMessagesV2:r-room:50"]);
});

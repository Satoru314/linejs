import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Client } from "@evex-dev/linejs";
import { fetchRecentChats } from "../src/commands/chats.ts";
import { fetchBotContacts } from "../src/commands/shared.ts";

function contact(mid: string, name: string, userType: string, status?: string) {
	return {
		targetUserMid: mid,
		userType,
		targetProfileDetail: {
			profileName: name,
			statusMessage: { value: status ?? "" },
		},
	};
}

test("chats recent merges users, BOTs, groups, and rooms by last message time", async () => {
	const calls = { boxes: 0, contacts: 0, chats: 0 };
	const client = {
		base: {
			talk: {
				async getMessageBoxes({ messageBoxListRequest }: never) {
					calls.boxes += 1;
					assert.deepEqual(messageBoxListRequest, {
						activeOnly: true,
						withUnreadCount: true,
						messageBoxCountLimit: 20,
					});
					return {
						messageBoxes: [
							{
								id: "u-user",
								unreadCount: 2,
								lastDeliveredMessageId: { deliveredTime: 1000, messageId: 1 },
							},
							{
								id: "c-group",
								unreadCount: 5,
								lastDeliveredMessageId: { deliveredTime: 3000, messageId: 2 },
							},
							{
								id: "u-bot",
								unreadCount: 0,
								lastDeliveredMessageId: { deliveredTime: 4000, messageId: 3 },
							},
							{
								id: "r-room",
								unreadCount: 1,
								lastDeliveredMessageId: { deliveredTime: 2000, messageId: 4 },
							},
						],
					};
				},
				async getChats({ chatMids }: { chatMids: string[] }) {
					calls.chats += 1;
					assert.deepEqual(chatMids.sort(), ["c-group", "r-room"]);
					return {
						chats: [
							{ chatMid: "c-group", chatName: "Project group", type: "GROUP" },
							{ chatMid: "r-room", chatName: "Team room", type: "ROOM" },
						],
					};
				},
			},
			relation: {
				async getContactsV3({ mids }: { mids: string[] }) {
					calls.contacts += 1;
					assert.deepEqual(mids.sort(), ["u-bot", "u-user"]);
					return {
						responses: [
							contact("u-user", "User A", "USER"),
							contact("u-bot", "Official account", "BOT", "Support desk"),
						],
					};
				},
			},
		},
	} as never as Client;

	const chats = await fetchRecentChats(client, 20);
	assert.equal(calls.boxes, 1);
	assert.equal(calls.contacts, 1);
	assert.equal(calls.chats, 1);
	assert.deepEqual(
		chats.map((chat) => [chat.mid, chat.kind, chat.name]),
		[
			["u-bot", "BOT", "Official account"],
			["c-group", "GROUP", "Project group"],
			["r-room", "ROOM", "Team room"],
			["u-user", "USER", "User A"],
		],
	);
	assert.deepEqual(
		chats.map((chat) => chat.unreadCount),
		[0, 5, 1, 2],
	);
	assert.equal(chats[0]!.lastMessageTime, "1970-01-01T00:00:04.000Z");
	assert.equal(chats[0]!.statusMessage, "Support desk");
	assert.equal(chats[1]!.statusMessage, undefined);
});

test("fetchBotContacts returns only non-friend official accounts", async () => {
	let contactMids: string[] = [];
	const client = {
		base: {
			talk: {
				async getAllContactIds({ syncReason }: never) {
					assert.equal(syncReason, "INTERNAL");
					return ["u-user", "u-bot", "u-other"];
				},
			},
			relation: {
				async getContactsV3({ mids }: { mids: string[] }) {
					contactMids = mids;
					return {
						responses: [
							contact("u-bot", "Official account", "BOT", "News"),
							contact("u-other", "User B", "USER"),
						],
					};
				},
			},
		},
	} as never as Client;

	const bots = await fetchBotContacts(client, new Set(["u-user"]));
	assert.deepEqual(contactMids.sort(), ["u-bot", "u-other"]);
	assert.deepEqual(
		bots.map((bot) => [bot.mid, bot.displayName, bot.statusMessage]),
		[["u-bot", "Official account", "News"]],
	);
});

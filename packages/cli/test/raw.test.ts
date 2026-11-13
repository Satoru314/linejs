import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Chat, TalkMessage } from "@evex-dev/linejs";
import { summarizeChats } from "../src/commands/chats.ts";
import { chatSummary, talkMessageSummary } from "../src/commands/shared.ts";
import { findCommandByName } from "../src/registry.ts";

const RAW_CHAT = {
	type: "GROUP",
	memberCount: 3,
	notificationDisabled: false,
	picturePath: "picture-path",
	createdTime: 10,
	members: [{ userMid: "u-a" }, { userMid: "u-b" }],
};

const CHAT = {
	mid: "c-group",
	name: "Project group",
	raw: RAW_CHAT,
} as unknown as Chat;

const MESSAGE = {
	raw: {
		id: "123",
		toType: "GROUP",
		contentType: "NONE",
		createdTime: 20,
		deliveredTime: 21,
		relatedMessageId: "",
	},
	to: { id: "c-group" },
	from: { id: "u-a" },
	text: "hello",
	isEdited: false,
	updatedTime: 21,
} as unknown as TalkMessage;

test("chat summaries are small by default", () => {
	assert.deepEqual(chatSummary(CHAT), {
		mid: "c-group",
		name: "Project group",
		type: "GROUP",
		memberCount: 3,
	});
	assert.deepEqual(summarizeChats([CHAT], false), [chatSummary(CHAT)]);
});

test("chat summaries count group members without exposing extra", () => {
	const group = {
		mid: "c-anonymous-group",
		name: "Anonymous group",
		raw: {
			type: "GROUP",
			extra: {
				groupExtra: {
					invitationTicket: "fake-invitation-ticket",
					memberMids: {
						"u-member-one": 1,
						"u-member-two": 2,
						"u-member-three": 3,
					},
					inviteeMids: {},
				},
			},
		},
	} as unknown as Chat;
	const summary = chatSummary(group);
	assert.equal(summary.memberCount, 3);
	assert.equal("extra" in summary, false);
	const json = JSON.stringify(summary);
	assert.equal(json.includes("u-member"), false);
	assert.equal(json.includes("fake-invitation-ticket"), false);
	assert.equal("raw" in chatSummary(group, true), true);
});

test("chat summaries count room members from peer extras when present", () => {
	const room = {
		mid: "r-anonymous-room",
		name: "Anonymous room",
		raw: {
			type: "ROOM",
			extra: {
				peerAppExtra: {
					memberMids: { "u-member-one": 1, "u-member-two": 2 },
				},
			},
		},
	} as unknown as Chat;
	assert.equal(chatSummary(room).memberCount, 2);
});

test("chat summaries omit memberCount when it cannot be counted", () => {
	const chat = {
		mid: "c-anonymous-unknown",
		name: "Unknown group",
		raw: { type: "GROUP", extra: {} },
	} as unknown as Chat;
	assert.equal("memberCount" in chatSummary(chat), false);
});

test("--raw is the only way to include raw chat data", () => {
	const summary = chatSummary(CHAT, true);
	assert.deepEqual(Object.keys(summary).sort(), ["memberCount", "mid", "name", "raw", "type"]);
	assert.equal(summary.raw, RAW_CHAT);
	assert.equal(summarizeChats([CHAT], true)[0]!.raw, RAW_CHAT);
});

test("message summaries also follow the raw flag, not --json", () => {
	assert.equal("raw" in talkMessageSummary(MESSAGE, false), false);
	assert.equal(talkMessageSummary(MESSAGE, true).raw, MESSAGE.raw);
});

test("raw-taking commands expose the shared --raw option", () => {
	for (const name of [
		"chats list",
		"chats get",
		"chats messages",
		"contacts list",
		"contacts get",
		"contacts search",
		"messages show",
		"square list",
		"square get",
		"square chats",
		"square chat-get",
		"square events",
	]) {
		assert.equal(
			findCommandByName(name)?.options?.some((option) => option.name === "raw"),
			true,
			name,
		);
	}
});

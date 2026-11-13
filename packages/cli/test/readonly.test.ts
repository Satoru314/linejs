import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { CliError } from "../src/errors.ts";
import { EXECUTE_TOOL_NAME, LIST_TOOL_NAME, handleMcpMessage } from "../src/mcp/server.ts";
import { ProfileStore } from "../src/profile-store.ts";
import { assertReadOnlyApiCall, assertReadOnlyCommand, isReadOnlyMode } from "../src/readonly.ts";
import { findCommandByName } from "../src/registry.ts";

function output() {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		stdout,
		stderr,
		options: {
			stdout: (chunk: string) => stdout.push(chunk),
			stderr: (chunk: string) => stderr.push(chunk),
			interactive: false,
			color: false,
			handleSignals: false,
			env: { ...process.env, LINEJS_READONLY: "1", LINEJS_HOME: "/tmp/linejs-readonly-home" },
			cwd: "/tmp/linejs-readonly-cwd",
		},
	};
}

async function mcpCall(
	message: Record<string, unknown>,
	options: Parameters<typeof handleMcpMessage>[1] = {},
) {
	return (await handleMcpMessage({ jsonrpc: "2.0", ...message }, options)) as Record<
		string,
		unknown
	>;
}

test("read-only commands are allowlisted", () => {
	assert.equal(isReadOnlyMode({ LINEJS_READONLY: "1" }), true);
	assert.equal(isReadOnlyMode({ LINEJS_READONLY: "true" }), false);
	assert.equal(isReadOnlyMode({}), false);

	const readOnlyNames = [
		"chats list",
		"chats recent",
		"chats get",
		"chats messages",
		"contacts list",
		"contacts get",
		"profile get",
		"auth status",
		"api call",
	];
	for (const name of readOnlyNames) {
		assert.equal(findCommandByName(name)?.readOnly, true, name);
	}
	const writeNames = ["chats send", "chats leave", "contacts block", "messages read"];
	for (const name of writeNames) {
		assert.notEqual(findCommandByName(name)?.readOnly, true, name);
	}
});

test("read-only guard rejects writes with the command name and env var", () => {
	const send = findCommandByName("chats send")!;
	assert.throws(
		() => assertReadOnlyCommand(send, true),
		(error) =>
			error instanceof CliError &&
			error.code === "READ_ONLY" &&
			error.message.includes("chats send") &&
			error.message.includes("LINEJS_READONLY"),
	);
	assert.doesNotThrow(() => assertReadOnlyCommand(findCommandByName("chats list")!, true));
	assert.doesNotThrow(() => assertReadOnlyCommand(send, false));
});

test("api call allows only get/fetch methods in read-only mode", () => {
	assert.doesNotThrow(() => assertReadOnlyApiCall("api call", "getMessageBoxes", true));
	assert.doesNotThrow(() => assertReadOnlyApiCall("api call", "fetchSomething", true));
	assert.doesNotThrow(() => assertReadOnlyApiCall("api call", "sendMessage", false));
	assert.throws(
		() => assertReadOnlyApiCall("api call", "sendMessage", true),
		(error) =>
			error instanceof CliError &&
			error.code === "READ_ONLY" &&
			error.message.includes("sendMessage") &&
			error.message.includes("LINEJS_READONLY"),
	);
});

test("runCli rejects write commands before loading the profile", async () => {
	const captured = output();
	const result = await runCli(["chats", "send", "u-user", "hello", "--json"], captured.options);
	assert.equal(result.exitCode, 1);
	const parsed = JSON.parse(captured.stderr.join(""));
	assert.equal(parsed.error.code, "READ_ONLY");
	assert.match(parsed.error.message, /chats send/);
	assert.match(parsed.error.message, /LINEJS_READONLY/);
});

test("runCli rejects non-getter api call methods in read-only mode", async () => {
	const captured = output();
	const result = await runCli(
		["api", "call", "talk", "sendMessage", "--args", "{}", "--json"],
		captured.options,
	);
	assert.equal(result.exitCode, 1);
	const parsed = JSON.parse(captured.stderr.join(""));
	assert.equal(parsed.error.code, "READ_ONLY");
	assert.match(parsed.error.message, /api call/);
	assert.match(parsed.error.message, /sendMessage/);
	assert.match(parsed.error.message, /LINEJS_READONLY/);
});

test("runCli still runs read-only commands", async () => {
	const dir = await mkdtemp(join(tmpdir(), "linejs-readonly-"));
	try {
		const path = join(dir, "default.json");
		const store = await ProfileStore.open(path, { create: true });
		await store.setAuthToken("fake-token-readonly");
		await store.flush();

		const result = output();
		const exitCode = await runCli(["auth", "status", "--profile", path, "--json"], {
			...result.options,
			env: { ...result.options.env, LINEJS_HOME: dir },
			cwd: dir,
		});
		assert.equal(exitCode.exitCode, 0, result.stderr.join(""));
		const parsed = JSON.parse(result.stdout.join(""));
		assert.equal(parsed.authenticated, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("MCP execute applies the read-only allowlist", async () => {
	const received: string[][] = [];
	const executor = async (args: string[]) => {
		received.push(args);
		return { exitCode: 0, stdout: '{"ok":true}\n', stderr: "" };
	};
	const env = { LINEJS_READONLY: "1" };
	return (async () => {
		const send = await mcpCall(
			{
				id: 1,
				method: "tools/call",
				params: { name: EXECUTE_TOOL_NAME, arguments: { args: ["chats", "send", "u", "hi"] } },
			},
			{ executor, env },
		);
		const sendResult = send.result as { isError: boolean; content: Array<{ text: string }> };
		assert.equal(sendResult.isError, true);
		assert.match(sendResult.content[0]!.text, /READ_ONLY|LINEJS_READONLY/);
		assert.equal(received.length, 0);

		const list = await mcpCall(
			{
				id: 2,
				method: "tools/call",
				params: { name: EXECUTE_TOOL_NAME, arguments: { args: ["chats", "list"] } },
			},
			{ executor, env },
		);
		assert.equal((list.result as { isError?: boolean }).isError, undefined);
		assert.deepEqual(received[0], ["chats", "list", "--json"]);

		const getter = await mcpCall(
			{
				id: 3,
				method: "tools/call",
				params: {
					name: EXECUTE_TOOL_NAME,
					arguments: {
						args: ["api", "call", "talk", "getMessageBoxes", "--args", "{}"],
					},
				},
			},
			{ executor, env },
		);
		assert.equal((getter.result as { isError?: boolean }).isError, undefined);
		assert.deepEqual(received[1], [
			"api",
			"call",
			"talk",
			"getMessageBoxes",
			"--args",
			"{}",
			"--json",
		]);

		const writer = await mcpCall(
			{
				id: 4,
				method: "tools/call",
				params: {
					name: EXECUTE_TOOL_NAME,
					arguments: {
						args: ["api", "call", "talk", "sendMessage", "--args", "{}"],
					},
				},
			},
			{ executor, env },
		);
		const writerResult = writer.result as { isError: boolean; content: Array<{ text: string }> };
		assert.equal(writerResult.isError, true);
		assert.match(writerResult.content[0]!.text, /sendMessage/);
		assert.equal(received.length, 2);
	})();
});

test("list_linejs_cli exposes readOnly and adjusts mcpExecutable", async () => {
	const readOnly = await mcpCall(
		{ id: 5, method: "tools/call", params: { name: LIST_TOOL_NAME, arguments: {} } },
		{ env: { LINEJS_READONLY: "1" } },
	);
	const readOnlyCommands = (
		readOnly.result as {
			structuredContent: {
				commands: Array<{ name: string; readOnly: boolean; mcpExecutable: boolean }>;
			};
		}
	).structuredContent.commands;
	const list = readOnlyCommands.find((command) => command.name === "chats list")!;
	assert.equal(list.readOnly, true);
	assert.equal(list.mcpExecutable, true);
	const send = readOnlyCommands.find((command) => command.name === "chats send")!;
	assert.equal(send.readOnly, false);
	assert.equal(send.mcpExecutable, false);

	const normal = await mcpCall(
		{ id: 6, method: "tools/call", params: { name: LIST_TOOL_NAME, arguments: {} } },
		{ env: {} },
	);
	const normalSend = (
		normal.result as {
			structuredContent: { commands: Array<{ name: string; mcpExecutable: boolean }> };
		}
	).structuredContent.commands.find((command) => command.name === "chats send")!;
	assert.equal(normalSend.mcpExecutable, true);
});

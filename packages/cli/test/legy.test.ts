import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { MemoryStorage } from "@evex-dev/linejs/storage";
import { runCli } from "../src/cli.ts";
import { CommandContext, type CliSettings } from "../src/context.ts";
import { UsageError } from "../src/errors.ts";
import { parseLegyEncrypted, resolveLegyEncrypted } from "../src/legy.ts";
import { createCliExecutor } from "../src/mcp/server.ts";
import { Output } from "../src/output.ts";
import { createBase } from "../src/session.ts";

function settings(overrides: Partial<CliSettings> = {}): CliSettings {
	return {
		profile: {
			path: "/tmp/linejs-legy-test/default.json",
			name: "default",
			home: "/tmp/linejs-legy-test",
			explicitPath: false,
		},
		verbose: false,
		json: false,
		interactive: false,
		mcp: false,
		checkSession: false,
		env: {},
		cwd: "/tmp",
		signal: new AbortController().signal,
		...overrides,
	};
}

function createBaseWith(overrides: Partial<CliSettings>) {
	const output = new Output({ stdout: () => {}, stderr: () => {} }, { json: false, color: false });
	const context = new CommandContext({
		options: {},
		positionals: [],
		output,
		settings: settings(overrides),
	});
	return createBase(context, undefined, new MemoryStorage(), "ANDROIDSECONDARY");
}

test("legy encrypted modes map to BaseClient values", () => {
	assert.equal(parseLegyEncrypted("auto", "--legy-encrypted"), "auto");
	assert.equal(parseLegyEncrypted("on", "--legy-encrypted"), true);
	assert.equal(parseLegyEncrypted("off", "--legy-encrypted"), false);
	assert.throws(() => parseLegyEncrypted("maybe", "--legy-encrypted"), UsageError);
});

test("--legy-encrypted off reaches BaseClient as encrypted: false", () => {
	const mode = resolveLegyEncrypted("off", {});
	assert.equal(createBaseWith({ legyEncrypted: mode }).legy.encrypted, false);
});

test("LINEJS_LEGY_ENCRYPTED=off reaches BaseClient as encrypted: false", () => {
	const mode = resolveLegyEncrypted(undefined, { LINEJS_LEGY_ENCRYPTED: "off" });
	assert.equal(createBaseWith({ legyEncrypted: mode }).legy.encrypted, false);
});

test("the option wins over the environment", () => {
	const mode = resolveLegyEncrypted("on", { LINEJS_LEGY_ENCRYPTED: "off" });
	assert.equal(mode, true);
	assert.equal(createBaseWith({ legyEncrypted: mode }).legy.encrypted, true);
});

test("an unset setting keeps the BaseClient default", () => {
	const mode = resolveLegyEncrypted(undefined, {});
	assert.equal(mode, undefined);
	assert.equal(createBaseWith({ legyEncrypted: mode }).legy.encrypted, "auto");
});

test("invalid environment values are usage errors", () => {
	assert.throws(
		() => resolveLegyEncrypted(undefined, { LINEJS_LEGY_ENCRYPTED: "true" }),
		UsageError,
	);
});

test("help lists the LEGY encrypted option and environment variable", async () => {
	const stdout: string[] = [];
	const result = await runCli(["help"], {
		stdout: (chunk) => stdout.push(chunk),
		stderr: () => {},
		interactive: false,
		color: false,
		handleSignals: false,
		env: {},
		cwd: "/tmp",
	});
	assert.equal(result.exitCode, 0);
	const help = stdout.join("");
	assert.match(help, /--legy-encrypted <mode> \(auto\|on\|off\)/);
	assert.match(help, /LINEJS_LEGY_ENCRYPTED\s+LEGY encrypted gateway mode/);
});

test("invalid --legy-encrypted values fail before connecting", async () => {
	const stderr: string[] = [];
	const result = await runCli(["profile", "get", "--legy-encrypted", "maybe"], {
		stdout: () => {},
		stderr: (chunk) => stderr.push(chunk),
		interactive: false,
		color: false,
		handleSignals: false,
		env: {},
		cwd: "/tmp",
	});
	assert.equal(result.exitCode, 2);
	assert.match(stderr.join(""), /Invalid value for --legy-encrypted: maybe/);
});

test("execute_linejs_cli inherits LINEJS_LEGY_ENCRYPTED from the server", async () => {
	const run = createCliExecutor({
		LINEJS_HOME: "/tmp/linejs-legy-mcp-home",
		LINEJS_LEGY_ENCRYPTED: "maybe",
	});
	const result = await run(["profile", "get"]);
	assert.equal(result.exitCode, 2);
	assert.match(result.stderr, /Invalid value for LINEJS_LEGY_ENCRYPTED: maybe/);
});

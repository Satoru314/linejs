import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.ts";

test("api call rejects array --args and asks for an object", async () => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const result = await runCli(
		["api", "call", "talk", "getMessageBoxes", "--args", "[]", "--json"],
		{
			stdout: (chunk) => stdout.push(chunk),
			stderr: (chunk) => stderr.push(chunk),
			interactive: false,
			color: false,
			handleSignals: false,
			env: { ...process.env, LINEJS_HOME: "/tmp/linejs-api-test-home" },
			cwd: "/tmp/linejs-api-test-cwd",
		},
	);
	assert.equal(result.exitCode, 2);
	const parsed = JSON.parse(stderr.join(""));
	assert.equal(parsed.error.code, "USAGE");
	assert.match(parsed.error.message, /JSON object/);
	assert.match(parsed.error.message, /not an array/);
});

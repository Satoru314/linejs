import type { CommandSpec } from "./command.ts";
import { CliError } from "./errors.ts";

/** Environment variable that turns on the allowlist-based read-only mode. */
export const READONLY_ENV = "LINEJS_READONLY";

export function isReadOnlyMode(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[READONLY_ENV] === "1";
}

function readOnlyError(command: string, message: string): CliError {
	return new CliError("READ_ONLY", message, {
		details: { command, env: READONLY_ENV },
	});
}

/**
 * Commands are denied by default in read-only mode. Only a command that
 * explicitly declares `readOnly: true` may run.
 */
export function assertReadOnlyCommand(command: CommandSpec, readOnlyMode: boolean): void {
	if (!readOnlyMode || command.readOnly) return;
	throw readOnlyError(
		command.name,
		`${command.name} is disabled because ${READONLY_ENV} is enabled.`,
	);
}

/**
 * The raw API bridge is conditionally read-only: only getter-style methods are
 * allowed when LINEJS_READONLY is enabled.
 */
export function assertReadOnlyApiCall(
	command: string,
	method: string | undefined,
	readOnlyMode: boolean,
): void {
	if (!readOnlyMode) return;
	if (method && (method.startsWith("get") || method.startsWith("fetch"))) return;
	throw readOnlyError(
		command,
		`${command} ${method ?? "(missing method)"} is disabled because ${READONLY_ENV} is enabled; only methods starting with "get" or "fetch" are allowed in read-only mode.`,
	);
}

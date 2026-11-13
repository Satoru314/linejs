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
 * Getter-style methods that still return credentials or key material. The
 * `get`/`fetch` prefix only says that a method does not look like a writer, so
 * these names are denied explicitly in read-only mode.
 */
export const READONLY_DENIED_API_METHODS = [
	// Generic storage access can read the refresh token and E2EE keys.
	"get",
	"getAccessToken",
	"getAlbumChannelToken",
	"getE2EEGroupSharedKey",
	"getE2EEKeyBackupCertificates",
	"getE2EEKeyBackupInfo",
	"getE2EELocalPublicKey",
	"getE2EESelfKeyData",
	"getE2EESelfKeyDataByKeyId",
	"getInvitationTicketUrl",
	"getLastE2EEGroupSharedKey",
	"getLiffToken",
	"getLiffViewWithoutUserContext",
	"getLiveTalkInvitationUrl",
	"getReturnUrlWithRequestTokenForAutoLogin",
	"getToken",
] as const;

const DENIED_API_METHODS = new Set<string>(READONLY_DENIED_API_METHODS);

/**
 * The raw API bridge is conditionally read-only: only getter-style methods are
 * allowed when LINEJS_READONLY is enabled, except for methods that return
 * tokens, keys, sessions, or other credentials.
 */
export function assertReadOnlyApiCall(
	command: string,
	method: string | undefined,
	readOnlyMode: boolean,
): void {
	if (!readOnlyMode) return;
	if (
		method &&
		(method.startsWith("get") || method.startsWith("fetch")) &&
		!DENIED_API_METHODS.has(method)
	) {
		return;
	}
	throw readOnlyError(
		command,
		`${command} ${method ?? "(missing method)"} is disabled because ${READONLY_ENV} is enabled; only getter-style methods that do not return secrets are allowed in read-only mode.`,
	);
}

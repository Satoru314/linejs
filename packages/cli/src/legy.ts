import { UsageError } from "./errors.ts";

export const LEGY_ENCRYPTED_MODES = ["auto", "on", "off"] as const;

/** Value passed to BaseClient's `legy.encrypted` option. */
export type LegyEncryptedMode = boolean | "auto";

/**
 * Convert the CLI spelling (`auto` / `on` / `off`) to the BaseClient value.
 * `on` and `off` force the encrypted gateway on or off; `auto` keeps the
 * default token-based heuristic.
 */
export function parseLegyEncrypted(value: string, source: string): LegyEncryptedMode {
	switch (value) {
		case "auto":
			return "auto";
		case "on":
			return true;
		case "off":
			return false;
		default:
			throw new UsageError(
				`Invalid value for ${source}: ${value} (expected ${LEGY_ENCRYPTED_MODES.join(", ")})`,
			);
	}
}

/**
 * Resolve the LEGY encrypted mode from the option or LINEJS_LEGY_ENCRYPTED.
 * The option wins over the environment; undefined keeps the BaseClient default.
 */
export function resolveLegyEncrypted(
	option: string | undefined,
	env: NodeJS.ProcessEnv,
): LegyEncryptedMode | undefined {
	if (option !== undefined) return parseLegyEncrypted(option, "--legy-encrypted");
	const value = env.LINEJS_LEGY_ENCRYPTED;
	if (value === undefined || value === "") return undefined;
	return parseLegyEncrypted(value, "LINEJS_LEGY_ENCRYPTED");
}

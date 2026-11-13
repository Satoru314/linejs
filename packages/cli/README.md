# @evex-dev/linejs-cli

Command-line interface and MCP server for
[LINEJS](https://linejs.evex.land). It exposes the same client, storage,
OpenChat, Album, VOOM, LIFF, Birthday Board, and raw Thrift/REST surfaces as
the library, with a `line` binary and machine-readable `--json` output.

```sh
npm install -g @evex-dev/linejs-cli
# or run without installing:
npx -p @evex-dev/linejs-cli line --help
```

Requires Node.js 22.18+, 24.11+, or 26+.

## Quick start

```sh
# Show the QR code in the terminal and save the session to ~/.linejs/default.json
line auth login

line auth status
line profile get
line contacts list
line chats recent
line chats list
line chats messages c... -n 20
line chats send c... "Hello from linejs"
line listen --square
```

QR codes and PINs are printed to **stderr** so pipelines and `--json` remain
valid. With `--json`, successful results go to stdout and errors are emitted to
stderr as `{"error": {...}}`. The profile file stores the auth token plus LINEJS
internal storage (E2EE keys, refresh token, reqseq) and the last fetched
profile. It is written atomically with mode `0600`.

After login, normal commands reuse the cached profile and do **not** call
`getProfile()`. Pass `--check-session` to verify the token and refresh the cache
first. `auth *` commands still check automatically.

## Profiles

```sh
line auth login --profile work            # ~/.linejs/work.json
line auth login --profile ./backup.json   # ./backup.json
line --profile work contacts list
line auth profiles
line auth logout --yes
```

Resolution rules:

| `--profile` value      | Location                   |
| ---------------------- | -------------------------- |
| omitted                | `~/.linejs/default.json`   |
| `work`                 | `~/.linejs/work.json`      |
| `work.json`            | `~/.linejs/work.json`      |
| `./profiles/work.json` | `<cwd>/profiles/work.json` |
| `/tmp/line.json`       | `/tmp/line.json`           |

`LINEJS_HOME` overrides `~/.linejs`, and `LINEJS_PROFILE` sets the default
profile name/path. Use `--device`, `--app-version`, and `--endpoint` to override
the emulated client without rewriting the profile.

## Authentication

```sh
line auth login                                  # QR (default)
line auth login --qr-format ansi                 # compact|unicode|ansi|ascii|none
line auth login --email me@example.com --password-stdin
line auth login --token "$LINE_TOKEN" --force
line auth login --no-save --json                 # one-off; prints the token
line auth status --verify
line auth token                                  # treat as a secret
```

Passwords are never stored. A new profile refuses to overwrite an existing one
unless `--force` is passed. QR login is the safest first login because it
registers the E2EE key material; token-only logins may lack group E2EE keys.

## Global options

| Option                    | Description                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--json`                  | Print the result as JSON; streaming commands use NDJSON.                                                                                         |
| `--check-session`         | Verify the token with `getProfile()` and refresh the cached profile. Auth commands always do this; others use the cache unless this flag is set. |
| `--profile <name\|path>`  | Select the profile file.                                                                                                                         |
| `--device <device>`       | `DESKTOPWIN`, `DESKTOPMAC`, `ANDROID`, `ANDROIDSECONDARY`, `IOS`, `IOSIPAD`, `WATCHOS`, `WEAROS`.                                                |
| `--app-version <version>` | Emulated LINE app version.                                                                                                                       |
| `--endpoint <host>`       | LEGY endpoint override.                                                                                                                          |
| `--timeout <ms>`          | Request timeout (default 30000).                                                                                                                 |
| `--verbose`, `-v`         | Write LINEJS request logs to stderr.                                                                                                             |
| `--no-color`              | Disable ANSI colors.                                                                                                                             |
| `--help`, `-h`            | Command help.                                                                                                                                    |
| `--version`               | CLI version.                                                                                                                                     |

Run `line commands` or `line commands --json` for the full command list.
`line help <command>` prints usage, options, and examples.

## Read-only mode

Set `LINEJS_READONLY=1` to deny every command that is not explicitly marked as
read-only. This is an allowlist: a command without `readOnly: true` in its
`CommandSpec` is rejected even if it happens to be harmless, so new commands
stay safe until they are reviewed. Mark a command as read-only only when it
does not change state **and** does not return secrets such as tokens, keys, or
sessions. Commands that print secrets (`auth token`, `liff token`, `liff view`,
`voom token`, `storage get`, `storage list --values`, `storage export`) and
commands that write local files (`moa download`, `messages data`,
`square message-data`) are therefore not read-only.

```sh
LINEJS_READONLY=1 line chats list --json
LINEJS_READONLY=1 line chats send u... "hello"   # READ_ONLY error
```

`api call` is allowed only for method names that start with `get` or `fetch`,
and even then a known list of credential-returning methods is denied (for
example `getToken`, `getLiffToken`, `getE2EESelfKeyData`,
`getE2EEGroupSharedKey`, and the generic `get` storage accessor):

```sh
LINEJS_READONLY=1 line api call talk getMessageBoxes --args '{"messageBoxListRequest":{}}'
LINEJS_READONLY=1 line api call talk sendMessage --args '{}'   # READ_ONLY error
LINEJS_READONLY=1 line api call e2ee getE2EESelfKeyData --args '{"mid":"u..."}'   # READ_ONLY error
```

The MCP server applies the same rule to `execute_linejs_cli`, and
`list_linejs_cli` reports each command's `readOnly` flag plus an
`mcpExecutable` value that is `false` for rejected commands. `line mcp` itself
stays available in read-only mode because the server only forwards calls; every
`execute_linejs_cli` call is checked against the same allowlist. MCP Events
stay available too: `line listen` is read-only, subscriptions live in memory
only, and webhook payloads never contain tokens or keys (`includeText: false`
also removes user-authored text).

```sh
LINEJS_READONLY=1 line mcp
```

## Commands

- **auth**: `login`, `status`, `token`, `logout`, `profiles`
- **profile**: `get`, `update`, `image`, `background` (`get` uses the cached profile; add `--check-session` for a fresh `getProfile()`)
- **contacts**: `list`, `get`, `add`, `search`, `rename`, `favorite`, `mute`,
  `hide`, `calendar`, `block`, `unblock`, `blocked` (`list --include-bots` also
  returns official accounts that are not in the friend list)
- **chats**: `list`, `recent`, `get`, `messages`, `send`, `send-media`, `compact`,
  `create`, `invite`, `kick`, `leave`, `rename`, `bgm get`, `bgm set`
  (`recent` reads the active inbox and includes 1:1 BOT chats; `list` only
  returns joined groups and rooms)
- **messages**: `react`, `cancel-reaction`, `unsend`, `read`, `reply`, `show`,
  `pin`, `data`
- **square**: `list`, `get`, `chats`, `chat-get`, `chat-members`,
  `chat-send`, `chat-media`, `chat-rename`, `chat-invite`, `chat-leave`,
  `join`, `leave`, `create`, `rename`, `search`, `events`, `react`,
  `message-reply`, `message-read`, `message-unsend`, `message-destroy`, `message-data`
- **timeline** / **note**: `post`, `list`, `get`, `update`, `delete`, `share`,
  `like`, `comment`; `timeline upload`
- **moa**: `albums`, `photos`, `download`
- **media**: `upload`, `download`, `object`
- **call**: `route`, `group-route`, `group`, `url list|create|get|update|delete`,
  `join`, `invite`, `kick` (control plane only; media transport is not exposed)
- **liff**: `token`, `view`, `share`, `share-text`
- **voom**: `token`, `feed`, `status`, `call`
- **birthday**: `board-id`, `board`, `cards`, `celebrations`, `likes`,
  `templates`, `create`, `update`, `delete`, `delete-board`, `permission`,
  `like`, `unlike`, `celebrate`, `cancel-celebration`, `report`
- **storage**: `list`, `get`, `set`, `delete`, `clear`, `export`
- **api**: `services`, `methods`, `call` — raw access to every public LINEJS
  service method
- **listen**: stream talk/OpenChat events
- **mcp**: run the MCP server over stdio

Examples:

```sh
line chats send-media u... ./photo.jpg
line messages react 123456789 NICE
line square chat-send m... "hello"
line square events m... -n 50
line timeline post c... "Hello Note"
line media upload ./file.pdf --to c... --type file
line storage get reqseq
line --json contacts list | jq '.contacts[].displayName'
```

### Raw API bridge

Every public method on `client`, `client.base`, and its services (`talk`,
`square`, `relation`, `call`, `liff`, `moa`, `timeline`, `obs`, `e2ee`, …) is
available. Pass a JSON **object** as the single method argument. Arrays are
rejected so the call shape stays unambiguous.

```sh
line api services
line api methods talk
line api call talk getProfile --args '{}'
line api call square getSquare --args '{"squareMid":"s..."}'
line api call call acquireGroupCallRoute --args '{"chatMid":"c...","mediaType":"AUDIO"}'
line api call obs downloadObjectForService \
  --args '{"obsPath":"talk/m/...","oid":"..."}' --out ./file.bin
line api call talk getMessageBoxes \
  --args '{"messageBoxListRequest":{"activeOnly":true,"withUnreadCount":true,"messageBoxCountLimit":20}}'
line api call talk getRecentMessagesV2 \
  --args '{"messageBoxId":"u...","messagesCount":20}'
```

Use `line api methods <service>` to discover method names. This is the escape
hatch for newer APIs that do not have a dedicated command yet.

### Reading old messages

`chats messages` reads directly from the message box with `getRecentMessagesV2`
instead of searching the active inbox first. This also works for 1:1 chats that
are not in `getMessageBoxes()`. An empty result is not an error: the JSON output
contains `"historyAvailable": false` because LINE may not expose older messages
through this API. Real missing-chat or permission errors are returned as-is.

JSON output stays small by default: `chats list` returns only `mid`, `name`,
`type`, and a numeric `memberCount` (omitted when the count is unknown).
Group and room member maps are not included; pass `--raw` on commands that
expose it (`chats list|get|messages`, `contacts list|get|search`,
`messages show`, and the `square` read commands) to include the full LINEJS
object. `chats recent` fills a BOT's `statusMessage` from `getContactsV2` when
`getContactsV3` leaves it empty.

### Listening

```sh
line listen                    # talk messages
line listen --square           # OpenChat events
line listen --json --duration 60
line listen --events --count 5
```

With `--json`, each event is one JSON line (NDJSON), followed by a summary
object. Press Ctrl+C to stop.

## MCP server

```sh
line mcp
```

The stdio server exposes two tools:

- `list_linejs_cli` — lists every command with arguments, options, category,
  `readOnly`, and whether it is MCP-executable.
- `execute_linejs_cli` — receives an argv array (without the leading `line`)
  and executes the CLI **in-process, without a shell**. `--json` is forced and
  long-running commands (`listen`, `mcp`) are rejected.

Start with `chats recent`, not `chats list`: messages from companies and agents
usually arrive in 1:1 chats with official accounts (BOT), and those are not in
the joined group/room list. MID prefixes are `u` (user or BOT), `c` (group), and
`r` (multi-person room). Old messages may not be available from the server.
`api call` takes a JSON **object** in `--args` (not an array), for example
`{"messageBoxId":"u...","messagesCount":20}` for `getRecentMessagesV2`. When
`LINEJS_READONLY=1` is set, the server explains in both tool descriptions that
only `readOnly` commands can run.

Example client configuration:

```json
{
	"mcpServers": {
		"linejs": {
			"command": "line",
			"args": ["mcp"]
		}
	}
}
```

or with npx:

```json
{
	"mcpServers": {
		"linejs": {
			"command": "npx",
			"args": ["-y", "-p", "@evex-dev/linejs-cli", "line", "mcp"]
		}
	}
}
```

The MCP process runs with the same filesystem permissions as your user. Keep
the profile secret; `execute_linejs_cli` can call any non-long-running CLI
command, including `api call`. Log in from a terminal before exposing the
server: QR/PIN prompts produced during a tool call are only returned when that
call finishes, so interactive login is awkward over MCP.

### MCP Events (webhooks)

The server also implements the [MCP Events](https://github.com/modelcontextprotocol/experimental-ext-triggers-events)
webhook extension that ChatGPT consumes. It advertises `events` in the
`initialize` capabilities and answers `events/list`, `events/subscribe`, and
`events/unsubscribe` on the same stdio connection.

Available events (`delivery: ["webhook"]`):

| Event                            | Fires when                                    |
| -------------------------------- | --------------------------------------------- |
| `line.message.received`          | a talk message arrives in a 1:1 or group chat |
| `line.message.edited`            | a visible talk message is edited              |
| `line.openchat.message.received` | a message arrives in an OpenChat room         |

Subscription arguments are `chatId` and `from` (glob patterns) plus
`includeText` (default `true`). Payloads stay small on purpose: `messageId`,
`chatId`, `from`, `contentType`, a whitespace-collapsed text preview of at most
400 characters, and `receivedAt`/`updatedAt`. Disable `includeText` to keep
user-authored text out of the webhook entirely.

Lifecycle and delivery:

- `events/subscribe` requires a `whsec_` signing secret (24–64 random bytes,
  base64) and an `https` callback URL. The server first POSTs a signed
  `{"type":"verification","challenge":"…"}` envelope and activates delivery only
  when the endpoint echoes the challenge in a `2xx` response.
- Deliveries use Standard Webhooks headers (`webhook-id`, `webhook-timestamp`,
  `webhook-signature`) plus `X-MCP-Subscription-Id`, signed with
  HMAC-SHA256 over `id.timestamp.body`. Retries use exponential backoff, and
  `410`/`413` are final.
- Subscriptions are keyed on `(profile, callback URL, event name, arguments)`,
  so `events/subscribe` doubles as the refresh call. The granted TTL is 15
  minutes by default (min 1 minute, max 1 hour); `ttlMs: null` is answered with
  a finite grant because subscription state is in memory only. Expired or
  suspended subscriptions and their `deliveryStatus` are reported on refresh.
- Callback URLs are resolved and validated on every attempt. `http`, embedded
  credentials, redirects, and non-public addresses (loopback, RFC 1918, link
  local, ULA, multicast, …) are rejected.
- Events are not replayable: `cursor` is always `null`. If the listener or the
  MCP process restarts, events from the gap are gone.

ChatGPT talks to remote servers over Streamable HTTP, while `line mcp` speaks
stdio. Put the process behind a stdio↔HTTP bridge if you want ChatGPT to
connect directly; `line mcp --profile work` scopes the events to that profile.

## Security

- `~/.linejs/*.json` contains an auth token and E2EE key material. Never commit
  or share it. The CLI creates the directory with mode `0700` and files with
  `0600`, but you should still protect backups.
- Prefer QR login for the first session and token reuse afterwards. Repeated
  email/password logins can trigger LINE account restrictions.
- `line auth token` and `line storage list --values` print secrets.
- Using LINEJS may violate LINE's terms of service and can lead to account
  restrictions. Use at your own risk.
- Do not run the MCP server for untrusted clients.

## Development

```sh
pnpm install
pnpm line --help                       # run the CLI from the repository root via tsx
pnpm --filter @evex-dev/linejs-cli run build
pnpm --filter @evex-dev/linejs-cli run typecheck
pnpm --filter @evex-dev/linejs-cli test
```

The built binary is `packages/cli/dist/line.mjs` and is published as `line`.

# Changelog

## [1.6.0] - 2026-03-19

### Added
- **`search-threads` CLI command** — `node cli.js search-threads "query"` with `--status`, `--limit`, `--cursor` options. Client-side limit validation (1–50). Outputs JSON results (#88)
- **Bot join event handling** — Listens for `bot_join_request` and `bot_status_changed` WebSocket events, formats and forwards to C4 admin endpoint (#89)
- **Structured admin tags** — `[priority:high] [action:notify-owner]` tags on bot join request messages for programmatic agent matching (#90)

## [1.5.0] - 2026-03-16

### Added
- **Media auto-download**: Automatically download Hub media attachments (image/file parts) to local filesystem before C4 dispatch — bots now receive local file paths instead of opaque Hub file IDs (#82)
- **`download-file` CLI command**: Proactive media retrieval via `node cli.js download-file <file_id>` with `--out`, `--max-bytes`, `--timeout` options. For on-demand downloads outside the automatic runtime path (#84, #85)
- **Non-text message part forwarding**: Image, file, and link message parts are now forwarded to C4 instead of being silently dropped (#77, #78)

### Fixed
- **@all mention recognition**: `@all` / `mention_all` now correctly triggers thread message delivery (#80)
- **Input guards and MIME defaults**: Harden input validation, add fallback MIME type, and forward reply attachments correctly (#79)
- **SDK download options**: Explicit options for SDK `downloadFile()`, async filesystem ops, tighter regex validation, sync lock file handling
- **Truncation counter**: Only counts attachment-producing parts, not all non-text parts

### Changed
- Requires `@coco-xyz/hxa-connect-sdk` `^1.4.0` for `downloadFile()` / `downloadToPath()` APIs
- Media download uses SDK methods with opaque file ID handling (no URL construction)

## [1.4.8] - 2026-03-12

### Changed
- **Config migration Phase 5**: Org-level `threadMode` migrated to per-thread `mode` field on all configured threads, then removed. Threads without explicit mode are backfilled with the org-level value or `'mention'` default.
- **Org-level `threadMode` removed**: `getThreadMode()` no longer falls back to org-level `threadMode`. All threads must have explicit `mode` field (set by migration or admin CLI). New/unconfigured threads default to `mention`.
- **SKILL.md**: Added upgrade notice — must use `zylos upgrade hxa-connect`, not manual git pull

## [1.4.7] - 2026-03-12

### Added
- **Per-thread mode**: Thread-level `mode` setting (`mention` or `smart`) with three-tier fallback: per-thread → org-level threadMode (deprecated) → `mention` default
- **[SKIP] outbound filter**: Messages starting with `[SKIP]` are suppressed in thread sends only — DMs unaffected
- Config migration: org-level `threadMode` preserved as deprecated fallback for backward compatibility

### Changed
- Rate-limit check moved after mention-mode early return — non-@mention messages no longer consume token bucket

## [1.4.6] - 2026-03-09

### Changed
- Bump `@coco-xyz/hxa-connect-sdk` from `^1.3.0` to `^1.3.1` (fix: @all / @所有人 now triggers delivery for all bots via mention_all field)

## [1.4.5] - 2026-03-07

### Added
- **Per-sender rate limiting (M-04)**: Token bucket algorithm — 10 burst capacity, 5 tokens refilled per 10s. Applied to both DM and thread mention handlers. Excess messages are dropped with a warning log.
- **C4 concurrency cap (M-07)**: Maximum 10 concurrent `execFile` calls to C4. Both initial send and retry paths enforce the cap. Excess calls are dropped with a warning log.

### Changed
- **Docs**: Emphasize @mention requirement for thread messages — without `@bot_name` in the message body, the target bot will not receive the message

### Security
- Closes #63 — rate limiting + concurrency cap prevent message flooding and subprocess exhaustion

## [1.4.4] - 2026-03-05

### Changed
- Bump `@coco-xyz/hxa-connect-sdk` from `^1.2.0` to `^1.3.0` (reply-to support)

### Supersedes
- v1.4.3 (released with old SDK dep — use v1.4.4 instead)

## [1.4.3] - 2026-03-05 (superseded by v1.4.4)

### Added
- **Reply-to send support**: Outbound thread messages automatically include `reply_to` when the trigger message ID is available (mirrors Telegram's msg: pattern)
- **Mention and reply-to documentation** in SKILL.md — usage examples for @bot-name, @all, and `<replying-to>` tag format

### Fixed
- **Reply-to tag injection hardening**: Sanitize reply content to prevent `</replying-to>` tag breakage (including whitespace variants)
- **Fallback log accuracy**: Success log now correctly reflects whether reply_to was actually used or fell back to plain send

## [1.4.2] - 2026-03-04

### Fixed
- Bump `@coco-xyz/hxa-connect-sdk` minimum version from `^1.1.1` to `^1.2.0` — v1.4.0+ depends on SDK v1.2.0 features (session_invalidated event, human provenance bypass in ThreadContext)

## [1.4.1] - 2026-03-04

### Fixed
- Write explicit `dmPolicy`/`groupPolicy` defaults in config during post-install (#48)

## [1.4.0] - 2026-03-04

### Added
- **Per-org enabled flag**: Selectively disable individual orgs without removing config (`enabled: false`)
- **Explicit enabled field migration**: Phase 3 migration auto-adds `enabled: true` to existing orgs missing the field; new orgs default to `enabled: true`
- **SDK session_invalidated handling**: Handles 4002 close code — logs event and exits for PM2 restart
- `ack` added to HANDLED_EVENTS set
- SKILL.md updated with per-org enabled flag documentation

### Changed
- Thread message formatting uses XML tags instead of plain-text markers
- SDK dependency bumped to `^1.2.0` (session_invalidated event support)

### Fixed
- Self-message filter now allows human-authored messages through (was incorrectly blocking)

## [1.3.1] - 2026-03-02

### Changed
- **groupPolicy now gates thread access**: Threads are the group chat primitive; `groupPolicy` enforcement moved from `channel_message` handler to `threadCtx.onMention` callback
- Removed `channel_message` handler — channels are exclusively DMs, group channels no longer exist
- Config key `access.channels` renamed to `access.threads`; admin CLI commands renamed (`list-channels` → `list-threads`, `add-channel` → `add-thread`, etc.)
- SDK dependency bumped to `^1.1.1` (removed `'group'` from `Channel.type`)
- Updated DESIGN.md, SKILL.md, and routing reference docs to reflect thread-only group model

### Fixed
- `groupPolicy` was incorrectly applied to channel messages instead of thread messages

## [1.3.0] - 2026-03-01

### Added
- **Per-org access control**: DM policy (`open`/`allowlist`), channel policy (`open`/`allowlist`/`disabled`), per-channel sender allowlists
- **Thread smart mode**: Per-org `threadMode` setting — `mention` (default, @mention only) or `smart` (all messages delivered, AI decides relevance via `[SKIP]`)
- `src/admin.js` CLI for managing access policies and thread mode
- `src/lib/auth.js` — DM, channel, and sender policy enforcement
- `src/lib/config.js` — shared config loader/saver for admin CLI
- Config migration Phase 2: global access fields auto-migrate to per-org `access` (per-field merge, idempotent)

### Changed
- ThreadContext setup uses `triggerPatterns: [/^/]` for smart mode (SDK-compatible catch-all)
- Mention detection mirrors SDK's `extractText` logic (checks `content` + `parts[].content`)
- DESIGN.md and SKILL.md updated with access control and thread mode documentation

## [1.2.0] - 2026-03-01

### Added
- **Multi-org support**: Connect to multiple HXA-Connect organizations simultaneously
- Config auto-migration from single-org to multi-org format (lossless, with backup)
- `org:<label>|<target>` endpoint encoding for C4 routing (channel stays `hxa-connect`)
- Per-org WebSocket clients with independent reconnect
- `--org <label>` flag for CLI and send.js (debug override)
- Explicit `channel:` endpoint error handling (server API limitation)
- DESIGN.md documenting multi-org architecture and routing decisions
- `hooks/pre-upgrade.js` for upgrade safety checks

### Changed
- `sendToC4` uses `execFile` instead of `exec` (security: no shell injection)
- CLI `VALUE_FLAGS` parsing fixes for `--reusable`/`--stdin` flags
- Failed org connections call `client.disconnect()` before cleanup
- CLI `migrateConfig()`/`resolveOrgs()` errors emit JSON instead of stack traces
- Config migration uses PID-unique temp files to avoid concurrent write races
- SKILL.md config section updated from env vars to file-based config reference
- `Promise.allSettled` for parallel org connections (one failure doesn't block others)

### Fixed
- Max-retry org connection properly disconnects WS client before removal

## [1.1.0] - 2026-03-01

### Added
- `thread-join` CLI command — self-join a thread within the same org
- `bot_renamed` added to HANDLED_EVENTS set

### Changed
- SDK dependency updated to v1.1.0 (v1.2.0 server compat)
- Removed `'open'` from thread status references in CLI help and SKILL.md
- Updated compatibility table for v1.2.0

## [1.0.2] - 2026-02-26

### Fixed
- SKILL.md frontmatter version synced with package.json (was stuck at 0.4.0)

## [1.0.1] - 2026-02-26

### Added
- `scripts/cli.js` — Full SDK CLI with 23 subcommands (queries, thread ops, artifacts, profile, admin). All JSON output.
- SKILL.md updated with complete CLI documentation

### Fixed
- SDK updated to v1.0.1: `agent_online`/`agent_offline` events renamed to `bot_online`/`bot_offline`
- Bot presence event handlers updated to use `msg.bot` field (was `msg.agent`)

## [1.0.0] - 2026-02-26

### Changed
- **Version reset**: Rebrand to HXA-Connect (from BotsHub). Reset version to 1.0.0.
- **SDK dependency pinned**: `hxa-connect-sdk` locked to `v1.0.0` tag (was floating `main`)

### Added (carried from 0.x)
- WebSocket transport with HxaConnectClient SDK
- Auto-reconnect with exponential backoff
- C4 bridge integration for DM, thread, and artifact event forwarding
- Thread message sending via `send.js thread:<id> "message"`
- ThreadContext support with @mention triggers and buffered context delivery
- Bot presence logging (online/offline events)
- HTTPS proxy support for restricted networks
- Post-install/post-upgrade hooks with auto-registration
- PM2 service configuration
- Self-message echo guard

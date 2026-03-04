# Changelog

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

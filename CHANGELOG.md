# Changelog

## [0.4.0] - 2026-02-24

### Changed
- **SDK upgrade to Phase 4 GA**: Updated botshub-sdk with auto-reconnect, ThreadContext, and protocol updates
- **Thread tags**: Thread `type` replaced with `tags` array — thread_created handler updated accordingly
- **Participant events enriched**: thread_participant events now include `bot_name`, `by` (inviter), and `label` fields

### Added
- **channel_deleted event handler**: Logs channel deletion events from the hub
- **New SDK features available**: ReconnectOptions, ThreadContext class, toPromptContext() for LLM-ready output, OrgSettings/AuditEntry/WebhookHealth types

## [0.3.1] - 2026-02-22

### Fixed
- **Self-message echo guard**: Added truthiness check for `isSelf()` to handle missing AGENT_ID gracefully (#6)
- **Agent event field path**: Fixed `agent_online`/`agent_offline` event payload field extraction (#6)
- **Startup warning**: Log warning when AGENT_ID is not configured (#6)

## [0.3.0] - 2026-02-22

### Added
- **botshub-sdk integration**: Outbound messages sent via SDK instead of raw curl
- **Thread event handling**: thread_created, thread_message, thread_updated, thread_artifact, thread_participant events forwarded to C4
- **Thread message sending**: `send.js thread:<id> "message"` for thread replies
- **Agent presence logging**: agent_online/agent_offline events logged
- **Shared env module**: DRY config/env loading across bot.js and send.js

### Changed
- send.js rewritten to use BotsHubClient SDK (replaces curl/execSync)
- bot.js refactored with switch-based event dispatch
- WebSocket token URL-encoded for safety
- Version bumped to 0.3.0

## [0.2.0] - 2026-02-19

### Changed
- Post-install auto-registers agent using org API key — no manual agent_token needed
- Config schema: replaced `agent_token` + `hub_url` + `agent_name` with `BOTSHUB_ORG_KEY` + `BOTSHUB_URL` + `BOTSHUB_AGENT_NAME`
- Unified to single `agent_name` identifier (display_name removed)

### Added
- HTTPS proxy support in registration (post-install hook)
- Skip registration if config.json already has agent_token (re-install safety)

## [0.1.1] - 2026-02-17

### Fixed
- WebSocket keepalive ping every 30s to prevent idle connection drops (#2)
- Timer cleanup in SIGINT/SIGTERM shutdown handlers (#2)

### Changed
- Log connection uptime on WebSocket close (#2)
- Backoff reset only when reconnectDelay has grown beyond base value (#2)

## [0.1.0] - 2026-02-15

### Added
- WebSocket transport for BotsHub connectivity
- Auto-reconnect with exponential backoff
- C4 bridge integration for message forwarding
- HTTPS proxy support for restricted networks
- DM and group channel message handling
- Outbound send script via BotsHub REST API
- PM2 service configuration
- Post-install and post-upgrade hooks

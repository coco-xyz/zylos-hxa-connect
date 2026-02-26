# Changelog

## [1.0.1] - 2026-02-26

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

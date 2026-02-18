# Changelog

## [0.2.0] - 2026-02-19

### Changed
- Post-install auto-registers agent using org API key — no manual agent_token needed
- Config schema: replaced `agent_token` + `hub_url` + `agent_name` with `BOTSHUB_ORG_KEY` + `BOTSHUB_URL` + `BOTSHUB_AGENT_NAME`
- agent_name and display_name are now always equal (single install parameter)

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

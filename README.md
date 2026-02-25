# zylos-botshub

BotsHub communication component for Zylos agents. Connects to a [BotsHub](https://github.com/coco-xyz/bots-hub) messaging hub via WebSocket, enabling agent-to-agent communication.

## Features

- **WebSocket transport** — No public endpoint needed. Works behind firewalls/NAT.
- **Auto-reconnect** — Exponential backoff on disconnection.
- **C4 bridge integration** — Messages route through the Zylos C4 comm-bridge.
- **Proxy support** — Optional HTTPS proxy for restricted networks.

## Setup

### 1. Register on BotsHub

Get an org ID and registration ticket from your org admin, then register:

```bash
curl -sf -X POST ${HUB_URL}/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"org_id": "YOUR_ORG_ID", "ticket": "YOUR_TICKET", "name": "my-agent", "display_name": "My Agent"}'
```

Save the returned `token`.

### 2. Create config

Create `~/zylos/components/botshub/config.json`:

```json
{
  "hub_url": "https://your-hub.example.com/hub",
  "agent_id": "your-agent-id",
  "agent_token": "agent_your_token_here",
  "agent_name": "my-agent",
  "display_name": "My Agent"
}
```

### 3. Install dependencies

```bash
npm install
```

### 4. Start service

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Sending messages

Via C4 bridge:
```bash
node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "botshub" "<agent_name>" "message"
```

Directly:
```bash
node scripts/send.js <agent_name> "message"
```

## Environment

Optional proxy configuration in `~/zylos/.env`:

```bash
HTTPS_PROXY=http://your-proxy:port
```

## License

MIT

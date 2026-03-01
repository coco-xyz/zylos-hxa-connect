# Multi-Org Architecture

## Overview

zylos-hxa-connect connects to one or more HXA-Connect organizations simultaneously via WebSocket. Each org gets its own `HxaConnectClient` instance with independent reconnection.

## C4 Contract

**Channel is always `hxa-connect`** — never suffixed with org labels.

C4 comm-bridge uses the channel name to resolve the script path (`SKILLS_DIR/<channel>/scripts/send.js`). A channel like `hxa-connect:coco` would break path resolution. This is a hard constraint of the comm-bridge protocol.

## Endpoint Encoding

Org routing is encoded in the endpoint, not the channel.

### Format

```
org:<label>|<target>
```

Where `<target>` is one of:
- `<bot_name>` — DM
- `thread:<uuid>` — Thread message
- `channel:<uuid>` — Group channel (receive-only, see below)

### Examples

```
zylos0t                      # default org, DM
thread:abc123                # default org, thread
org:coco|zylos0t             # org "coco", DM
org:coco|thread:abc123       # org "coco", thread
```

### Parsing

```js
const ORG_PREFIX_RE = /^org:([a-z0-9][a-z0-9-]*)\|(.+)$/;
// Match → { orgLabel, target }
// No match → default org, entire string is target
```

## Single vs Multi-Org Behavior

| Condition | `isMultiOrg` | Endpoint format | Display prefix |
|-----------|-------------|-----------------|----------------|
| One org, label "default" | `false` | bare (no `org:` prefix) | `[HXA-Connect ...]` |
| One org, non-default label | `true` | `org:<label>\|...` | `[HXA:<label> ...]` |
| Multiple orgs | `true` | `org:<label>\|...` | `[HXA:<label> ...]` |

Single-org "default" preserves the exact same endpoint format as pre-multi-org versions. No migration needed on the C4 side.

## Org Resolution (send.js)

Priority order:
1. `--org <label>` flag (debug override)
2. `org:<label>|` prefix parsed from endpoint
3. `"default"` org if it exists
4. First org in config

## Channel Endpoints

`channel:<uuid>` endpoints are **receive-only**. The HXA-Connect server has no `POST /api/channels/:id/messages` endpoint — there's no HTTP API to send to a group channel by ID. `send.js` exits with a clear error if a `channel:` target is encountered.

## Config Format

### New format (multi-org)

```json
{
  "default_hub_url": "https://connect.coco.xyz/hub",
  "orgs": {
    "coco": {
      "org_id": "...",
      "agent_id": "...",
      "agent_token": "agent_...",
      "agent_name": "zylos01",
      "hub_url": null
    }
  }
}
```

### Old format (single-org, auto-migrated)

```json
{
  "hub_url": "https://connect.coco.xyz/hub",
  "org_id": "...",
  "agent_id": "...",
  "agent_token": "agent_...",
  "agent_name": "zylos01"
}
```

### Migration

On startup, `migrateConfig()` detects old format (top-level `org_id`) and:
1. Backs up to `config.json.bak`
2. Writes new format with label `"default"`
3. Uses PID-unique temp file for atomic write
4. Idempotent — already-new config is a no-op

### Label rules

`/^[a-z0-9][a-z0-9-]*$/` — lowercase alphanumeric, hyphens allowed, no colons/spaces/uppercase.

## Connection Model

```
Map<label, { client, threadCtx, config }>
```

- Each org gets its own `HxaConnectClient` + `ThreadContext`
- `Promise.allSettled` for parallel startup (one failure doesn't block others)
- Max 20 retry attempts per org with exponential backoff
- Failed orgs are removed from the map; if all fail, process exits
- Graceful shutdown disconnects all clients

## Access Control

DM and channel (group) access is controlled via top-level config fields. No owner concept — purely policy-based.

### Config Fields

```json
{
  "dmPolicy": "open",
  "dmAllowFrom": [],
  "groupPolicy": "open",
  "channels": {}
}
```

### DM Policy

| Policy | Behavior |
|--------|----------|
| `open` (default) | Any bot can DM |
| `allowlist` | Only bots in `dmAllowFrom` (case-insensitive match on sender name) |

### Channel (Group) Policy

| Policy | Behavior |
|--------|----------|
| `open` (default) | All channels accepted |
| `allowlist` | Only channels in `channels` map; per-channel `allowFrom` for sender filtering |
| `disabled` | All channel messages rejected |

### Per-Channel Config

```json
{
  "channels": {
    "<channel_id>": {
      "name": "general",
      "allowFrom": ["*"],
      "added_at": "2026-03-01T..."
    }
  }
}
```

`allowFrom`: Array of sender names. `["*"]` or empty = allow all senders.

### Decision Flow

```
DM message → isDmAllowed(config, senderName)
  open → pass
  allowlist → check dmAllowFrom

Channel message → isChannelAllowed(config, channelId)
  disabled → reject
  open → pass
  allowlist → check channels map
  → isSenderAllowed(config, channelId, senderName)
    allowFrom empty or ["*"] → pass
    else → check sender in allowFrom

Thread @mention → handled by SDK ThreadContext (no policy gate)
```

### Admin CLI

`src/admin.js` provides commands for managing policies and allowlists. Changes require `pm2 restart zylos-hxa-connect`.

## Hooks

| Hook | Purpose |
|------|---------|
| `post-install.js` | Register agent, write new-format config |
| `pre-upgrade.js` | Backup config, validate format |
| `post-upgrade.js` | Schema migrations (e.g., remove deprecated fields) |

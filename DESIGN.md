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

### New format (multi-org with per-org access)

```json
{
  "default_hub_url": "https://connect.coco.xyz/hub",
  "orgs": {
    "coco": {
      "org_id": "...",
      "agent_id": "...",
      "agent_token": "agent_...",
      "agent_name": "zylos01",
      "hub_url": null,
      "access": {
        "dmPolicy": "open",
        "dmAllowFrom": [],
        "groupPolicy": "open",
        "threads": {}
      }
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

`migrateConfig()` runs two idempotent phases on startup:

**Phase 1: single-org → multi-org** (detects top-level `org_id`):
1. Backs up to `config.json.bak`
2. Moves org fields into `orgs.default`
3. Moves any access fields (dmPolicy, etc.) into `orgs.default.access`
4. Preserves unknown top-level keys

**Phase 2: global access → per-org access** (detects top-level access keys):
1. Backfills missing access fields into each org's `access` (per-field merge — existing keys preserved)
2. Removes global access keys

Both phases use atomic write (PID-unique temp file + rename). Empty/corrupted JSON produces a readable error and exits.

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

Per-org DM and thread (group) access control. No owner concept — purely policy-based. Each org has independent policies under `orgs.<label>.access`.

Channels are DMs (direct messages). Group channels no longer exist — threads are the group chat primitive.

### Per-Org Access Config

```json
{
  "access": {
    "dmPolicy": "open",
    "dmAllowFrom": [],
    "groupPolicy": "open",
    "threads": {},
    "threadMode": "mention"
  }
}
```

### DM Policy

| Policy | Behavior |
|--------|----------|
| `open` (default) | Any bot can DM |
| `allowlist` | Only bots in `dmAllowFrom` (case-insensitive match on sender name) |

### Group Policy (Thread Access)

`groupPolicy` controls which threads the bot participates in. Threads are the group chat equivalent.

| Policy | Behavior |
|--------|----------|
| `open` (default) | All threads accepted |
| `allowlist` | Only threads in `threads` map; per-thread `allowFrom` for sender filtering |
| `disabled` | All thread messages rejected |

### Per-Thread Config

```json
{
  "threads": {
    "<thread_id>": {
      "name": "general",
      "allowFrom": ["*"],
      "added_at": "2026-03-01T..."
    }
  }
}
```

`allowFrom`: Array of sender names. `["*"]` or empty = allow all senders.

### Decision Flow (per-org)

```
DM message (org X) → isDmAllowed(orgX.access, senderName)
  open → pass
  allowlist → check dmAllowFrom

Thread message (org X) → isThreadAllowed(orgX.access, threadId)
  disabled → reject
  open → pass
  allowlist → check threads map
  → isSenderAllowed(orgX.access, threadId, senderName)
    allowFrom empty or ["*"] → pass
    else → check sender in allowFrom
  → threadMode (mention|smart) controls delivery frequency
```

Two orgs can have completely different policies — org A can be open while org B uses allowlist.

### Thread Mode

Per-org thread response mode, controlling how the bot handles thread messages (applied after groupPolicy check).

| Mode | Behavior |
|------|----------|
| `mention` (default) | Bot only receives thread messages when @mentioned. SDK ThreadContext buffers messages and delivers them as context when triggered. |
| `smart` | Every thread message is delivered to the AI. A `<smart-mode>` hint instructs the AI to decide relevance — reply with `[SKIP]` to stay silent. Real @mentions are still recognized and delivered without the hint. |

Implementation: `smart` mode adds a catch-all `triggerPatterns: [/[\s\S]/]` to `ThreadContext`, causing every message to trigger delivery. The `onMention` handler checks if the trigger was a real @mention or a smart-mode catch-all and formats the message accordingly.

### Admin CLI

`src/admin.js [--org <label>] <command>` manages per-org policies. Without `--org`, targets the default org. Changes require `pm2 restart zylos-hxa-connect`.

## Hooks

| Hook | Purpose |
|------|---------|
| `post-install.js` | Register agent, write new-format config |
| `pre-upgrade.js` | Backup config, validate format |
| `post-upgrade.js` | Schema migrations (e.g., remove deprecated fields) |

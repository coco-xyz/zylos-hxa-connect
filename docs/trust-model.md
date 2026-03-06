# HxA Connect Trust Model

## Overview

HxA Connect uses a **hub-mediated trust model**. All messages between bots pass through a central hub server. The client trusts the hub to correctly identify message senders.

## Current Model: Trust the Hub

```
Bot A  ──WebSocket──>  Hub  ──WebSocket──>  Bot B
         (TLS)               (TLS)
```

- **Authentication**: Each bot authenticates to the hub using an `agent_token` over TLS.
- **Sender identity**: The hub attaches `sender_name` and `sender_id` to each message. Receiving bots use these fields for access control (`dmAllowFrom`, `allowFrom`).
- **No end-to-end verification**: There is no cryptographic signature from the sending bot. The receiving bot cannot independently verify that a message was actually sent by the claimed sender.
- **No certificate pinning**: The hub URL (`hub_url`) is read from `config.json` without certificate pinning. Config file integrity ([#58](https://github.com/coco-xyz/zylos-hxa-connect/issues/58)) is a prerequisite for connection security — a tampered `config.json` could redirect the client to a malicious hub.

## Trust Assumptions

1. **The hub is honest** — it correctly relays sender identity and does not forge messages.
2. **TLS is intact** — the connection between each bot and the hub is encrypted and authenticated.
3. **Hub operator is trusted** — whoever controls the hub infrastructure can read and modify any message in transit.

## What This Means

| Scenario | Protected? |
|----------|-----------|
| Bot impersonation by another bot | Yes — hub enforces registered identity |
| Eavesdropping on the wire | Yes — TLS encrypted |
| Compromised hub forging sender identity | **No** |
| Hub operator reading messages | **No** |
| Man-in-the-middle (TLS bypass) | Depends on certificate validation |

## Access Control

The client implements allowlists based on hub-provided identity:

- `dmPolicy` + `dmAllowFrom`: Controls who can send DMs
- `groupPolicy` + per-thread `allowFrom`: Controls thread participation

These are effective **only if the hub is trusted**. A compromised hub can bypass all allowlists by spoofing `sender_name`.

## Recommendations

### Current (acceptable for controlled deployments)

When the hub is operated by the same organization as the bots:
- The trust assumption holds — the hub operator is a known party.
- Focus on securing hub infrastructure and access credentials.
- Ensure `config.json` file permissions are restrictive (0600).

**Compensating controls** (until message signing is available):
- Restrict host access — only authorized users should have shell access to bot machines.
- Ensure only trusted operators can write to `config.json` (file permissions enforced by [#58](https://github.com/coco-xyz/zylos-hxa-connect/issues/58)).
- Monitor hub for unexpected bot registrations or identity changes.
- Review hub access logs periodically for anomalies.

### Future (for federated / multi-org deployments)

If HxA Connect expands to untrusted hubs or cross-org federation:
- Implement message signing (e.g., Ed25519 per-bot keypair).
- Include signed envelope: `{sender_id, timestamp, content_hash, signature}`.
- Receiving bot verifies signature against sender's registered public key.
- This would provide end-to-end sender authentication independent of hub trust.

## Related Issues

- [#61](https://github.com/coco-xyz/zylos-hxa-connect/issues/61) — C-02: Sender identity verification
- [#58](https://github.com/coco-xyz/zylos-hxa-connect/issues/58) — C-01: Token storage security

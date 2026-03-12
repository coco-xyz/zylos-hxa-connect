/**
 * zylos-hxa-connect - HXA-Connect WebSocket client for Zylos Bot
 * Connects to HXA-Connect hubs via SDK and bridges messages to C4.
 * Supports multiple orgs simultaneously.
 *
 * Handles: DM, threads, artifacts, participant events.
 * Uses hxa-connect-sdk for WS (session-based auth, auto-reconnect, 1012 support).
 */

import { HxaConnectClient, ThreadContext } from '@coco-xyz/hxa-connect-sdk';
import { execFile } from 'child_process';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { migrateConfig, resolveOrgs, setupFetchProxy, PROXY_URL } from './env.js';
import { isDmAllowed, isThreadAllowed, isSenderAllowed } from './lib/auth.js';

const HOME = process.env.HOME;
const C4_RECEIVE = path.join(HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');

const config = migrateConfig();
const resolved = resolveOrgs(config);
const orgLabels = Object.keys(resolved.orgs);
const isMultiOrg = orgLabels.length > 1 || !resolved.orgs.default;

const C4_CHANNEL = 'hxa-connect';

function c4Endpoint(label, endpoint) {
  if (!isMultiOrg && label === 'default') return endpoint;
  return `org:${label}|${endpoint}`;
}

function displayPrefix(label) {
  if (!isMultiOrg) return 'HXA-Connect';
  return `HXA:${label}`;
}

function logPrefix(label) {
  if (!isMultiOrg) return '[hxa-connect]';
  return `[hxa-connect:${label}]`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

await setupFetchProxy();

const MAX_WS_PAYLOAD = 1048576; // 1 MB
const MAX_CONTENT_LENGTH = 51200; // 50 KB

// ─── Rate Limiting (M-04) ────────────────────────────────

class TokenBucket {
  constructor(capacity = 10, refillRate = 5, refillIntervalMs = 10000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefill = Date.now();
  }

  consume() {
    this._refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed < this.refillIntervalMs) return;
    const intervals = Math.floor(elapsed / this.refillIntervalMs);
    this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillRate);
    this.lastRefill += intervals * this.refillIntervalMs;
  }
}

// Per-sender rate limiters (keyed by org:senderId)
const rateLimiters = new Map();

function getRateLimiter(key) {
  let bucket = rateLimiters.get(key);
  if (!bucket) {
    bucket = new TokenBucket(10, 5, 10000);
    rateLimiters.set(key, bucket);
  }
  return bucket;
}

// ─── C4 Concurrency Cap (M-07) ──────────────────────────

const MAX_CONCURRENT_C4 = 10;
let _activeC4Calls = 0;

const wsOptions = {
  maxPayload: MAX_WS_PAYLOAD,
  ...(PROXY_URL ? { agent: new HttpsProxyAgent(PROXY_URL) } : {}),
};

// ─── C4 Bridge ─────────────────────────────────────────────

function sendToC4(channel, endpoint, content) {
  if (!content) return;
  if (_activeC4Calls >= MAX_CONCURRENT_C4) {
    console.warn(`[hxa-connect] C4 concurrency cap reached (${MAX_CONCURRENT_C4}), dropping message`);
    return;
  }
  _activeC4Calls++;
  const c4Args = [C4_RECEIVE, '--channel', channel, '--endpoint', endpoint, '--json', '--content', content];

  execFile('node', c4Args, { encoding: 'utf8' }, (error, stdout) => {
    _activeC4Calls--;
    if (!error) {
      console.log(`[hxa-connect] -> C4: ${content.substring(0, 80)}...`);
      return;
    }
    try {
      const response = JSON.parse(error.stdout || stdout || '{}');
      if (response.ok === false && response.error?.message) {
        console.warn(`[hxa-connect] C4 rejected: ${response.error.message}`);
        return;
      }
    } catch {}
    console.warn(`[hxa-connect] C4 send failed, retrying: ${error.message}`);
    setTimeout(() => {
      if (_activeC4Calls >= MAX_CONCURRENT_C4) {
        console.warn(`[hxa-connect] C4 concurrency cap reached on retry, dropping`);
        return;
      }
      _activeC4Calls++;
      execFile('node', c4Args, { encoding: 'utf8' }, (retryErr) => {
        _activeC4Calls--;
        if (retryErr) console.error(`[hxa-connect] C4 retry failed: ${retryErr.message}`);
        else console.log(`[hxa-connect] -> C4 (retry): ${content.substring(0, 80)}...`);
      });
    }, 2000);
  });
}

// ─── Constants ──────────────────────────────────────────────

const HANDLED_EVENTS = new Set([
  'message', 'channel_message', 'thread_created', 'thread_message',
  'thread_updated', 'thread_artifact', 'thread_participant',
  'channel_deleted', 'channel_created', 'bot_online', 'bot_offline', 'bot_renamed', 'thread_status_changed',
  'reconnecting', 'reconnected', 'reconnect_failed', 'error', 'close', 'pong',
  'ack', 'session_invalidated',
]);

const MAX_CONNECT_ATTEMPTS = 20;

// ─── Per-Org Connection Setup ──────────────────────────────

const connections = new Map();

for (const [label, org] of Object.entries(resolved.orgs)) {
  const lp = logPrefix(label);
  const dp = displayPrefix(label);

  if (!org.hubUrl) {
    console.error(`${lp} Skipping — no hub_url configured (neither per-org nor default)`);
    continue;
  }

  if (!org.agentId) {
    console.error(`${lp} agent_id is required — without it, isSelf() cannot filter self-messages. Set agent_id in config.json for org "${label}"`);
    continue;
  }

  const client = new HxaConnectClient({
    url: org.hubUrl,
    token: org.agentToken,
    orgId: org.orgId,
    wsOptions,
    reconnect: {
      enabled: true,
      initialDelay: 3000,
      maxDelay: 60000,
      backoffFactor: 1.5,
    },
  });

  const isSelf = (id, metadata) => {
    if (!org.agentId || id !== org.agentId) return false;
    // Human-authored messages via Web UI should not be treated as self-echo
    const meta = typeof metadata === 'string'
      ? (() => { try { return JSON.parse(metadata); } catch { return null; } })()
      : metadata;
    if (meta?.provenance?.authored_by === 'human') return false;
    return true;
  };

  // ─── Event Handlers ───────────────────────────────────

  client.on('message', (msg) => {
    const sender = msg.sender_name || 'unknown';
    const content = msg.message?.content || msg.content || '';
    if (isSelf(msg.message?.sender_id, msg.message?.metadata)) return;

    if (content.length > MAX_CONTENT_LENGTH) {
      console.warn(`${lp} DM from ${sender} rejected — content too large (${content.length} bytes)`);
      return;
    }

    if (!isDmAllowed(org.access, sender)) {
      console.log(`${lp} DM from ${sender} rejected (dmPolicy: ${org.access?.dmPolicy || 'open'})`);
      return;
    }

    const rlKey = `${label}:dm:${msg.message?.sender_id || sender}`;
    if (!getRateLimiter(rlKey).consume()) {
      console.warn(`${lp} DM from ${sender} rate-limited, dropping`);
      return;
    }

    console.log(`${lp} DM from ${sender}: ${content.substring(0, 80)}`);
    const formatted = `[${dp} DM] ${sender} said: ${content}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, sender), formatted);
  });

  // channel_message handler removed — channels are DMs, group channels no longer exist.
  // groupPolicy now gates thread access (see threadCtx.onMention below).

  client.on('thread_created', (msg) => {
    const thread = msg.thread || {};
    const topic = thread.topic || 'untitled';
    const tags = thread.tags?.length ? thread.tags.join(', ') : 'none';
    console.log(`${lp} Thread created: "${topic}" (tags: ${tags})`);

    const formatted = `[${dp} Thread] New thread created: "${topic}" (tags: ${tags}, id: ${thread.id})`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${thread.id}`), formatted);
  });

  // ─── Thread @mention filtering (SDK ThreadContext) ───
  // Always catch all messages; per-thread mode filtering happens in onMention handler
  const threadCtx = new ThreadContext(client, {
    botNames: [org.agentName],
    botId: org.agentId || undefined,
    triggerPatterns: [/^/],
  });

  // Resolve thread mode: per-thread "mode" field, default "mention"
  function getThreadMode(threadId) {
    return org.access?.threads?.[threadId]?.mode || 'mention';
  }

  const mentionRe = new RegExp(
    `@${org.agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'
  );

  // Extract full text from message (mirrors SDK's extractText logic)
  function extractText(msg) {
    const parts = [msg.content || ''];
    if (msg.parts) {
      for (const part of msg.parts) {
        if ('content' in part && typeof part.content === 'string') {
          parts.push(part.content);
        }
      }
    }
    return parts.join(' ');
  }

  // Display-friendly sender name (human provenance aware)
  function msgSender(msg) {
    const botName = msg.sender_name || msg.sender_id || 'unknown';
    const meta = typeof msg.metadata === 'string'
      ? (() => { try { return JSON.parse(msg.metadata); } catch { return null; } })()
      : msg.metadata;
    if (meta?.provenance?.authored_by === 'human' && meta.provenance.owner_name) {
      return `${meta.provenance.owner_name} (via ${botName})`;
    }
    return botName;
  }

  threadCtx.onMention(({ threadId, message, snapshot }) => {
    const sender = msgSender(message);
    const content = message.content || '';

    if (content.length > MAX_CONTENT_LENGTH) {
      console.warn(`${lp} Thread ${threadId} from ${sender} rejected — content too large (${content.length} bytes)`);
      return;
    }

    // groupPolicy gates thread access (threads = group chat)
    if (!isThreadAllowed(org.access, threadId)) {
      console.log(`${lp} Thread ${threadId} rejected (groupPolicy: ${org.access?.groupPolicy || 'open'})`);
      return;
    }
    if (!isSenderAllowed(org.access, threadId, sender)) {
      console.log(`${lp} Sender ${sender} rejected in thread ${threadId}`);
      return;
    }

    const rlKey = `${label}:thread:${message.sender_id || sender}`;
    if (!getRateLimiter(rlKey).consume()) {
      console.warn(`${lp} Thread ${threadId} from ${sender} rate-limited, dropping`);
      return;
    }

    const isRealMention = mentionRe.test(extractText(message));
    const perThreadMode = getThreadMode(threadId);

    // In mention mode, skip messages that don't @mention the bot
    if (perThreadMode === 'mention' && !isRealMention) {
      return;
    }

    // Build C4 message with XML tags (consistent with Lark/TG format)
    const parts = [`[${dp} Thread:${threadId}] ${sender} said: `];

    // Thread context: previous messages (excluding trigger)
    const contextMsgs = snapshot.newMessages.filter(m => m.id !== message.id);
    if (contextMsgs.length > 0) {
      const lines = contextMsgs.map(m => `[${escapeXml(msgSender(m))}]: ${escapeXml(m.content || '')}`);
      parts.push(`<thread-context>\n${lines.join('\n')}\n</thread-context>\n\n`);
    }

    // Smart mode hint
    if (!isRealMention && perThreadMode === 'smart') {
      parts.push('<smart-mode>\nDecide whether to respond. Reply with exactly [SKIP] when a response is unnecessary.\n</smart-mode>\n\n');
    }

    // Reply-to context (like TG's replying-to format)
    if (message.reply_to_message) {
      const reply = message.reply_to_message;
      const replySender = escapeXml(reply.sender_name || reply.sender_id || 'unknown');
      const replyContent = escapeXml(reply.content || '');
      parts.push(`<replying-to>\n[${replySender}]: ${replyContent}\n</replying-to>\n\n`);
    }

    // Current message
    parts.push(`<current-message>\n${escapeXml(content)}\n</current-message>`);

    // Include trigger message ID in endpoint for reply-to on send (like TG's msg: pattern)
    const msgIdSuffix = message.id ? `|msg:${message.id}` : '';
    console.log(`${lp} Thread ${threadId} from ${sender} (${snapshot.bufferedCount} buffered)`);
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${threadId}${msgIdSuffix}`), parts.join(''));
  });

  client.on('thread_message', (msg) => {
    const message = msg.message || {};
    if (isSelf(message.sender_id, message.metadata)) return;
    const sender = message.sender_name || message.sender_id || 'unknown';
    const content = message.content || '';
    console.log(`${lp} Thread ${msg.thread_id} from ${sender} (buffered): ${content.substring(0, 80)}`);
  });

  client.on('thread_updated', (msg) => {
    const thread = msg.thread || {};
    const changes = msg.changes || [];
    const topic = thread.topic || 'untitled';
    console.log(`${lp} Thread updated: "${topic}" changes: ${changes.join(', ')}`);

    const formatted = `[${dp} Thread:${thread.id}] Thread "${topic}" updated: ${changes.join(', ')} (status: ${thread.status})`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${thread.id}`), formatted);
  });

  client.on('thread_artifact', (msg) => {
    const threadId = msg.thread_id;
    const artifact = msg.artifact || {};
    const action = msg.action || 'added';
    console.log(`${lp} Thread ${threadId} artifact ${action}: ${artifact.artifact_key}`);

    const formatted = `[${dp} Thread:${threadId}] Artifact ${action}: "${artifact.title || artifact.artifact_key}" (type: ${artifact.type})`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${threadId}`), formatted);
  });

  client.on('thread_participant', (msg) => {
    const threadId = msg.thread_id;
    const botName = msg.bot_name || msg.bot_id;
    const action = msg.action;
    const by = msg.by ? ` (by ${msg.by})` : '';
    const labelTag = msg.label ? ` [${msg.label}]` : '';
    console.log(`${lp} Thread ${threadId}: ${botName} ${action}${by}`);

    const formatted = `[${dp} Thread:${threadId}] ${botName}${labelTag} ${action} the thread${by}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${threadId}`), formatted);
  });

  client.on('thread_status_changed', (msg) => {
    const threadId = msg.thread_id;
    const topic = msg.topic || 'untitled';
    const from = msg.from || 'unknown';
    const to = msg.to || 'unknown';
    const by = msg.by ? ` (by ${msg.by})` : '';
    console.log(`${lp} Thread status changed: "${topic}" ${from} -> ${to}${by}`);

    const formatted = `[${dp} Thread:${threadId}] Thread "${topic}" status changed: ${from} -> ${to}${by}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${threadId}`), formatted);
  });

  client.on('bot_online', (msg) => {
    console.log(`${lp} ${msg.bot?.name || msg.bot?.id || 'unknown'} is online`);
  });

  client.on('bot_offline', (msg) => {
    console.log(`${lp} ${msg.bot?.name || msg.bot?.id || 'unknown'} is offline`);
  });

  // ─── Connection Lifecycle ──────────────────────────────

  client.on('reconnecting', ({ attempt, delay }) => {
    console.log(`${lp} Reconnecting (attempt ${attempt}, delay ${delay}ms)...`);
  });

  client.on('reconnected', ({ attempts }) => {
    console.log(`${lp} Reconnected after ${attempts} attempt(s)`);
  });

  client.on('reconnect_failed', ({ attempts }) => {
    console.error(`${lp} Reconnect failed after ${attempts} attempts`);
  });

  client.on('error', (err) => {
    console.error(`${lp} Error: ${err?.message || err}`);
  });

  client.on('session_invalidated', ({ code, reason }) => {
    console.error(`${lp} Session invalidated (code ${code}): ${reason || 'unknown'}`);
    console.error(`${lp} SDK will not auto-reconnect — exiting for PM2 restart`);
    process.exit(1);
  });

  client.on('*', (msg) => {
    if (msg?.type && !HANDLED_EVENTS.has(msg.type)) {
      console.log(`${lp} Unhandled event: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
    }
  });

  connections.set(label, { client, threadCtx, config: org });
}

// ─── Start All Connections ─────────────────────────────────

console.log(`[hxa-connect] Starting ${connections.size} org connection(s): ${orgLabels.join(', ')}`);

async function connectOrg(label, { client, threadCtx, config: org }) {
  const lp = logPrefix(label);
  const INITIAL_DELAY = 3000;
  const MAX_DELAY = 60000;
  const BACKOFF = 1.5;
  let attempt = 0;

  console.log(`${lp} Connecting as "${org.agentName}" to ${org.hubUrl} (org: ${org.orgId})`);

  while (attempt < MAX_CONNECT_ATTEMPTS) {
    try {
      await client.connect();
      console.log(`${lp} WebSocket connected`);
      await threadCtx.start();
      console.log(`${lp} ThreadContext started (mention filter for @${org.agentName})`);
      return;
    } catch (err) {
      try { client.disconnect(); } catch {}
      attempt++;
      const delay = Math.min(INITIAL_DELAY * Math.pow(BACKOFF, attempt - 1), MAX_DELAY);
      console.error(`${lp} Connection attempt ${attempt} failed: ${err.message}`);
      if (attempt >= MAX_CONNECT_ATTEMPTS) {
        console.error(`${lp} Giving up after ${attempt} attempts`);
        try { client.disconnect(); } catch {}
        connections.delete(label);
        return;
      }
      console.log(`${lp} Retrying in ${(delay / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

await Promise.allSettled(
  [...connections.entries()].map(([label, conn]) => connectOrg(label, conn))
);

if (connections.size === 0) {
  console.error('[hxa-connect] No orgs connected successfully — exiting');
  process.exit(1);
}

console.log(`[hxa-connect] ${connections.size} org(s) connected`);
console.log(`[hxa-connect] Proxy: ${PROXY_URL || 'none'}`);

// Graceful shutdown
function shutdown() {
  console.log('[hxa-connect] Shutting down...');
  for (const { client, threadCtx } of connections.values()) {
    threadCtx.stop();
    client.disconnect();
  }
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

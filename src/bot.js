/**
 * zylos-hxa-connect - HXA-Connect WebSocket client for Zylos Bot
 * Connects to HXA-Connect hubs via SDK and bridges messages to C4.
 * Supports multiple orgs simultaneously.
 *
 * Handles: DM, channel messages, threads, artifacts, participant events.
 * Uses hxa-connect-sdk for WS (ticket exchange, auto-reconnect, 1012 support).
 */

import { HxaConnectClient, ThreadContext } from '@coco-xyz/hxa-connect-sdk';
import { execFile } from 'child_process';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { migrateConfig, resolveOrgs, setupFetchProxy, PROXY_URL } from './env.js';

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

await setupFetchProxy();

const wsOptions = PROXY_URL ? { agent: new HttpsProxyAgent(PROXY_URL) } : undefined;

// ─── C4 Bridge ─────────────────────────────────────────────

function sendToC4(channel, endpoint, content) {
  if (!content) return;
  const c4Args = [C4_RECEIVE, '--channel', channel, '--endpoint', endpoint, '--json', '--content', content];

  execFile('node', c4Args, { encoding: 'utf8' }, (error, stdout) => {
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
      execFile('node', c4Args, { encoding: 'utf8' }, (retryErr) => {
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
]);

const MAX_CONNECT_ATTEMPTS = 20;

// ─── Per-Org Connection Setup ──────────────────────────────

const connections = new Map();

for (const [label, org] of Object.entries(resolved.orgs)) {
  const lp = logPrefix(label);
  const dp = displayPrefix(label);

  if (!org.hubUrl) {
    console.error(`${lp} No hub_url configured (neither per-org nor default)`);
    process.exit(1);
  }

  if (!org.agentId) {
    console.warn(`${lp} agent_id not set — self-message filter may be incomplete`);
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

  const isSelf = (id) => org.agentId && id === org.agentId;

  // ─── Event Handlers ───────────────────────────────────

  client.on('message', (msg) => {
    const sender = msg.sender_name || 'unknown';
    const content = msg.message?.content || msg.content || '';
    if (isSelf(msg.message?.sender_id)) return;

    console.log(`${lp} DM from ${sender}: ${content.substring(0, 80)}`);
    const formatted = `[${dp} DM] ${sender} said: ${content}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, sender), formatted);
  });

  client.on('channel_message', (msg) => {
    const sender = msg.sender_name || 'unknown';
    const chanId = msg.channel_id || 'unknown';
    const channelName = msg.channel_name || chanId;
    const content = msg.message?.content || msg.content || '';
    if (isSelf(msg.message?.sender_id)) return;

    console.log(`${lp} Channel ${channelName} from ${sender}: ${content.substring(0, 80)}`);
    const formatted = `[${dp} GROUP:${channelName}] ${sender} said: ${content}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `channel:${chanId}`), formatted);
  });

  client.on('thread_created', (msg) => {
    const thread = msg.thread || {};
    const topic = thread.topic || 'untitled';
    const tags = thread.tags?.length ? thread.tags.join(', ') : 'none';
    console.log(`${lp} Thread created: "${topic}" (tags: ${tags})`);

    const formatted = `[${dp} Thread] New thread created: "${topic}" (tags: ${tags}, id: ${thread.id})`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${thread.id}`), formatted);
  });

  // ─── Thread @mention filtering (SDK ThreadContext) ───
  const threadCtx = new ThreadContext(client, {
    botNames: [org.agentName],
    botId: org.agentId || undefined,
  });

  threadCtx.onMention(({ threadId, message, snapshot }) => {
    const sender = message.sender_name || message.sender_id || 'unknown';
    const context = threadCtx.toPromptContext(threadId, 'full');
    console.log(`${lp} Thread ${threadId} @mention by ${sender} (${snapshot.bufferedCount} buffered)`);
    const formatted = `[${dp} Thread:${threadId}] @mention by ${sender}\n\n${context}`;
    sendToC4(C4_CHANNEL, c4Endpoint(label, `thread:${threadId}`), formatted);
  });

  client.on('thread_message', (msg) => {
    const message = msg.message || {};
    if (isSelf(message.sender_id)) return;
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

  client.on('channel_deleted', (msg) => {
    console.log(`${lp} Channel deleted: ${msg.channel_id}`);
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

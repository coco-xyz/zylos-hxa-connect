/**
 * zylos-botshub - BotsHub WebSocket client for Zylos Agent
 * Connects to a BotsHub hub via SDK and bridges messages to C4.
 *
 * Handles: DM, channel messages, threads, artifacts, participant events.
 * Uses botshub-sdk for WS (ticket exchange, auto-reconnect, 1012 support).
 */

import { BotsHubClient } from 'botshub-sdk';
import { exec } from 'child_process';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { loadConfig, setupFetchProxy, PROXY_URL } from './env.js';

const HOME = process.env.HOME;
const C4_RECEIVE = path.join(HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');

const config = loadConfig();
const HUB_URL = config.hub_url;
const TOKEN = config.agent_token;
const ORG_ID = config.org_id;
const AGENT_NAME = config.agent_name;
const AGENT_ID = config.agent_id;

if (!HUB_URL || !TOKEN) {
  console.error('[botshub] hub_url and agent_token required in config.json');
  process.exit(1);
}
if (!ORG_ID) {
  console.error('[botshub] org_id required in config.json');
  process.exit(1);
}
if (!AGENT_ID) {
  console.warn('[botshub] agent_id not set in config.json — self-message filter may be incomplete');
}

// Set up proxy for fetch (HTTP requests via SDK)
await setupFetchProxy();

// Build WS options (proxy agent for Node.js ws)
const wsOptions = PROXY_URL ? { agent: new HttpsProxyAgent(PROXY_URL) } : undefined;

const client = new BotsHubClient({
  url: HUB_URL,
  token: TOKEN,
  orgId: ORG_ID,
  wsOptions,
  reconnect: {
    enabled: true,
    initialDelay: 3000,
    maxDelay: 60000,
    backoffFactor: 1.5,
  },
});

// ─── C4 Bridge ─────────────────────────────────────────────

function sendToC4(source, endpoint, content) {
  if (!content) return;
  const safeContent = content.replace(/'/g, "'\\''");
  const cmd = `node "${C4_RECEIVE}" --channel "${source}" --endpoint "${endpoint}" --json --content '${safeContent}'`;

  exec(cmd, { encoding: 'utf8' }, (error, stdout) => {
    if (!error) {
      console.log(`[botshub] → C4: ${content.substring(0, 80)}...`);
      return;
    }
    // Parse structured rejection
    try {
      const response = JSON.parse(error.stdout || stdout || '{}');
      if (response.ok === false && response.error?.message) {
        console.warn(`[botshub] C4 rejected: ${response.error.message}`);
        return;
      }
    } catch {}
    // Retry once
    console.warn(`[botshub] C4 send failed, retrying: ${error.message}`);
    setTimeout(() => {
      exec(cmd, { encoding: 'utf8' }, (retryErr) => {
        if (retryErr) console.error(`[botshub] C4 retry failed: ${retryErr.message}`);
        else console.log(`[botshub] → C4 (retry): ${content.substring(0, 80)}...`);
      });
    }, 2000);
  });
}

function isSelf(id) {
  return AGENT_ID && id === AGENT_ID;
}

// ─── Event Handlers ───────────────────────────────────────

client.on('message', (msg) => {
  const sender = msg.sender_name || 'unknown';
  const content = msg.message?.content || msg.content || '';
  if (isSelf(msg.message?.sender_id)) return;

  console.log(`[botshub] DM from ${sender}: ${content.substring(0, 80)}`);
  const formatted = `[BotsHub DM] ${sender} said: ${content}`;
  sendToC4('botshub', sender, formatted);
});

client.on('channel_message', (msg) => {
  const sender = msg.sender_name || 'unknown';
  const channel = msg.channel_id || 'unknown';
  const channelName = msg.channel_name || channel;
  const content = msg.message?.content || msg.content || '';
  if (isSelf(msg.message?.sender_id)) return;

  console.log(`[botshub] Channel ${channelName} from ${sender}: ${content.substring(0, 80)}`);
  const formatted = `[BotsHub GROUP:${channelName}] ${sender} said: ${content}`;
  sendToC4('botshub', `channel:${channel}`, formatted);
});

client.on('thread_created', (msg) => {
  const thread = msg.thread || {};
  const topic = thread.topic || 'untitled';
  const tags = thread.tags?.length ? thread.tags.join(', ') : 'none';
  console.log(`[botshub] Thread created: "${topic}" (tags: ${tags})`);

  const formatted = `[BotsHub Thread] New thread created: "${topic}" (tags: ${tags}, id: ${thread.id})`;
  sendToC4('botshub', `thread:${thread.id}`, formatted);
});

client.on('thread_message', (msg) => {
  const threadId = msg.thread_id;
  const message = msg.message || {};
  const sender = message.sender_name || message.sender_id || 'unknown';
  const content = message.content || '';
  if (isSelf(message.sender_id)) return;

  console.log(`[botshub] Thread ${threadId} from ${sender}: ${content.substring(0, 80)}`);
  const formatted = `[BotsHub Thread:${threadId}] ${sender} said: ${content}`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
});

client.on('thread_updated', (msg) => {
  const thread = msg.thread || {};
  const changes = msg.changes || [];
  const topic = thread.topic || 'untitled';
  console.log(`[botshub] Thread updated: "${topic}" changes: ${changes.join(', ')}`);

  const formatted = `[BotsHub Thread:${thread.id}] Thread "${topic}" updated: ${changes.join(', ')} (status: ${thread.status})`;
  sendToC4('botshub', `thread:${thread.id}`, formatted);
});

client.on('thread_artifact', (msg) => {
  const threadId = msg.thread_id;
  const artifact = msg.artifact || {};
  const action = msg.action || 'added';
  console.log(`[botshub] Thread ${threadId} artifact ${action}: ${artifact.artifact_key}`);

  const formatted = `[BotsHub Thread:${threadId}] Artifact ${action}: "${artifact.title || artifact.artifact_key}" (type: ${artifact.type})`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
});

client.on('thread_participant', (msg) => {
  const threadId = msg.thread_id;
  const botName = msg.bot_name || msg.bot_id;
  const action = msg.action; // 'joined' or 'left'
  const by = msg.by ? ` (by ${msg.by})` : '';
  const label = msg.label ? ` [${msg.label}]` : '';
  console.log(`[botshub] Thread ${threadId}: ${botName} ${action}${by}`);

  const formatted = `[BotsHub Thread:${threadId}] ${botName}${label} ${action} the thread${by}`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
});

client.on('channel_deleted', (msg) => {
  console.log(`[botshub] Channel deleted: ${msg.channel_id}`);
});

client.on('agent_online', (msg) => {
  console.log(`[botshub] ${msg.agent?.name || msg.agent?.id || 'unknown'} is online`);
});

client.on('agent_offline', (msg) => {
  console.log(`[botshub] ${msg.agent?.name || msg.agent?.id || 'unknown'} is offline`);
});

// ─── Connection Lifecycle ──────────────────────────────────

client.on('reconnecting', ({ attempt, delay }) => {
  console.log(`[botshub] Reconnecting (attempt ${attempt}, delay ${delay}ms)...`);
});

client.on('reconnected', ({ attempts }) => {
  console.log(`[botshub] Reconnected after ${attempts} attempt(s)`);
});

client.on('reconnect_failed', ({ attempts }) => {
  console.error(`[botshub] Reconnect failed after ${attempts} attempts`);
});

client.on('error', (err) => {
  console.error(`[botshub] Error: ${err?.message || err}`);
});

// Catch-all: log unhandled event types for observability
const HANDLED_EVENTS = new Set([
  'message', 'channel_message', 'thread_created', 'thread_message',
  'thread_updated', 'thread_artifact', 'thread_participant',
  'channel_deleted', 'agent_online', 'agent_offline',
  'reconnecting', 'reconnected', 'reconnect_failed', 'error', 'close', 'pong',
]);
client.on('*', (msg) => {
  if (msg?.type && !HANDLED_EVENTS.has(msg.type)) {
    console.log(`[botshub] Unhandled event: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
  }
});

// ─── Start ────────────────────────────────────────────────

console.log(`[botshub] zylos-botshub starting as "${AGENT_NAME}"`);
console.log(`[botshub] Hub: ${HUB_URL}`);
console.log(`[botshub] Org: ${ORG_ID}`);
console.log(`[botshub] Proxy: ${PROXY_URL || 'none'}`);

await connectWithRetry();

async function connectWithRetry() {
  // SDK auto-reconnect only kicks in after a successful connect + disconnect.
  // If the initial connect fails (e.g. ticket exchange error, network down),
  // no WebSocket is created so no 'close' event fires and no reconnect is scheduled.
  // We handle initial connection retries here with the same backoff parameters.
  const INITIAL_DELAY = 3000;
  const MAX_DELAY = 60000;
  const BACKOFF = 1.5;
  let attempt = 0;

  while (true) {
    try {
      await client.connect();
      console.log('[botshub] WebSocket connected');
      return;
    } catch (err) {
      attempt++;
      const delay = Math.min(INITIAL_DELAY * Math.pow(BACKOFF, attempt - 1), MAX_DELAY);
      console.error(`[botshub] Connection attempt ${attempt} failed: ${err.message}`);
      console.log(`[botshub] Retrying in ${(delay / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Graceful shutdown
function shutdown() {
  console.log('[botshub] Shutting down...');
  client.disconnect();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

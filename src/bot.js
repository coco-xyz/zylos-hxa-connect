/**
 * zylos-botshub - BotsHub WebSocket client for Zylos Agent
 * Connects to a BotsHub hub via WebSocket and bridges messages to C4.
 *
 * Handles: DM, channel messages, threads, artifacts, participant events.
 * Uses raw ws for WebSocket (proxy + reconnect support).
 */

import WebSocket from 'ws';
import { exec } from 'child_process';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { loadConfig, PROXY_URL } from './env.js';

const HOME = process.env.HOME;
const C4_RECEIVE = path.join(HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');

const config = loadConfig();
const HUB_URL = config.hub_url;
const TOKEN = config.agent_token;
const AGENT_NAME = config.agent_name;

if (!HUB_URL || !TOKEN) {
  console.error('[botshub] hub_url and agent_token required in config.json');
  process.exit(1);
}

/**
 * Send message to Claude via C4
 */
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

/**
 * Build WebSocket URL from hub URL
 */
function buildWsUrl() {
  const url = new URL(HUB_URL);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}${url.pathname.replace(/\/$/, '')}/ws?token=${encodeURIComponent(TOKEN)}`;
}

// ─── WebSocket Connection ─────────────────────────────────

let ws = null;
let reconnectDelay = 3000;
const MAX_RECONNECT_DELAY = 60000;
const PING_INTERVAL = 30000;
let pingTimer = null;
let connectedAt = 0;

function connect() {
  const wsUrl = buildWsUrl();
  console.log(`[botshub] Connecting to ${wsUrl.replace(/token=.*/, 'token=***')}...`);

  const wsOptions = {};
  if (PROXY_URL) {
    console.log(`[botshub] Using proxy: ${PROXY_URL}`);
    wsOptions.agent = new HttpsProxyAgent(PROXY_URL);
  }

  ws = new WebSocket(wsUrl, wsOptions);

  ws.on('open', () => {
    console.log('[botshub] WebSocket connected');
    connectedAt = Date.now();
    if (reconnectDelay > 3000) reconnectDelay = 3000;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.ping();
    }, PING_INTERVAL);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleEvent(msg);
    } catch (err) {
      console.error('[botshub] Failed to parse message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    const uptime = connectedAt ? ((Date.now() - connectedAt) / 1000).toFixed(0) : '0';
    console.log(`[botshub] WebSocket closed: ${code} ${reason || ''} (uptime: ${uptime}s)`);
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[botshub] WebSocket error: ${err.message}`);
  });
}

function scheduleReconnect() {
  console.log(`[botshub] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

// ─── Event Handlers ───────────────────────────────────────

function handleEvent(msg) {
  const type = msg.type;

  switch (type) {
    case 'message':
      handleDM(msg);
      break;
    case 'channel_message':
      handleChannelMessage(msg);
      break;
    case 'thread_created':
      handleThreadCreated(msg);
      break;
    case 'thread_message':
      handleThreadMessage(msg);
      break;
    case 'thread_updated':
      handleThreadUpdated(msg);
      break;
    case 'thread_artifact':
      handleThreadArtifact(msg);
      break;
    case 'thread_participant':
      handleThreadParticipant(msg);
      break;
    case 'ping':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;
    case 'agent_online':
    case 'agent_offline':
      console.log(`[botshub] ${msg.agent_name || msg.agent_id} is ${type === 'agent_online' ? 'online' : 'offline'}`);
      break;
    default:
      console.log(`[botshub] Event: ${type}`, JSON.stringify(msg).substring(0, 200));
  }
}

function handleDM(msg) {
  const sender = msg.sender_name || 'unknown';
  const content = msg.message?.content || msg.content || '';
  if (sender === AGENT_NAME) return;

  console.log(`[botshub] DM from ${sender}: ${content.substring(0, 80)}`);
  const formatted = `[BotsHub DM] ${sender} said: ${content}`;
  sendToC4('botshub', sender, formatted);
}

function handleChannelMessage(msg) {
  const sender = msg.sender_name || 'unknown';
  const channel = msg.channel_id || 'unknown';
  const channelName = msg.channel_name || channel;
  const content = msg.message?.content || msg.content || '';
  if (sender === AGENT_NAME) return;

  console.log(`[botshub] Channel ${channelName} from ${sender}: ${content.substring(0, 80)}`);
  const formatted = `[BotsHub GROUP:${channelName}] ${sender} said: ${content}`;
  sendToC4('botshub', `channel:${channel}`, formatted);
}

function handleThreadCreated(msg) {
  const thread = msg.thread || {};
  const topic = thread.topic || 'untitled';
  const threadType = thread.type || 'general';
  console.log(`[botshub] Thread created: "${topic}" (${threadType})`);

  const formatted = `[BotsHub Thread] New thread created: "${topic}" (type: ${threadType}, id: ${thread.id})`;
  sendToC4('botshub', `thread:${thread.id}`, formatted);
}

function handleThreadMessage(msg) {
  const threadId = msg.thread_id;
  const message = msg.message || {};
  const sender = message.sender_name || message.sender_id || 'unknown';
  const content = message.content || '';
  if (sender === AGENT_NAME) return;

  console.log(`[botshub] Thread ${threadId} from ${sender}: ${content.substring(0, 80)}`);

  const formatted = `[BotsHub Thread:${threadId}] ${sender} said: ${content}`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
}

function handleThreadUpdated(msg) {
  const thread = msg.thread || {};
  const changes = msg.changes || [];
  const topic = thread.topic || 'untitled';
  console.log(`[botshub] Thread updated: "${topic}" changes: ${changes.join(', ')}`);

  const formatted = `[BotsHub Thread:${thread.id}] Thread "${topic}" updated: ${changes.join(', ')} (status: ${thread.status})`;
  sendToC4('botshub', `thread:${thread.id}`, formatted);
}

function handleThreadArtifact(msg) {
  const threadId = msg.thread_id;
  const artifact = msg.artifact || {};
  const action = msg.action || 'added';
  console.log(`[botshub] Thread ${threadId} artifact ${action}: ${artifact.artifact_key}`);

  const formatted = `[BotsHub Thread:${threadId}] Artifact ${action}: "${artifact.title || artifact.artifact_key}" (type: ${artifact.type})`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
}

function handleThreadParticipant(msg) {
  const threadId = msg.thread_id;
  const botId = msg.bot_id;
  const action = msg.action; // 'joined' or 'left'
  console.log(`[botshub] Thread ${threadId}: ${botId} ${action}`);

  const formatted = `[BotsHub Thread:${threadId}] ${botId} ${action} the thread`;
  sendToC4('botshub', `thread:${threadId}`, formatted);
}

// ─── Start ────────────────────────────────────────────────

console.log(`[botshub] zylos-botshub starting as "${AGENT_NAME}"`);
console.log(`[botshub] Hub: ${HUB_URL}`);
console.log(`[botshub] Proxy: ${PROXY_URL || 'none'}`);
connect();

// Graceful shutdown
function shutdown() {
  console.log('[botshub] Shutting down...');
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (ws) ws.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

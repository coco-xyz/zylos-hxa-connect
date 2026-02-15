/**
 * zylos-botshub - BotsHub WebSocket client for Zylos Agent
 * Connects to a BotsHub hub via WebSocket and bridges messages to C4.
 */

import WebSocket from 'ws';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';

const HOME = process.env.HOME;
const CONFIG_PATH = path.join(HOME, 'zylos/components/botshub/config.json');
const C4_RECEIVE = path.join(HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');

// Load .env
const envPath = path.join(HOME, 'zylos/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[botshub] Failed to load config:', err.message);
    process.exit(1);
  }
}

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
      console.log(`[botshub] Sent to C4: ${content.substring(0, 80)}...`);
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
        else console.log(`[botshub] Sent to C4 (retry): ${content.substring(0, 80)}...`);
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
  return `${protocol}//${url.host}${url.pathname.replace(/\/$/, '')}/ws?token=${TOKEN}`;
}

/**
 * Connect to BotsHub via WebSocket with auto-reconnect
 */
let ws = null;
let reconnectDelay = 3000;
const MAX_RECONNECT_DELAY = 60000;

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
    reconnectDelay = 3000; // Reset on successful connection
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      console.error('[botshub] Failed to parse message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[botshub] WebSocket closed: ${code} ${reason || ''}`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[botshub] WebSocket error: ${err.message}`);
    // close event will fire after this, triggering reconnect
  });
}

function scheduleReconnect() {
  console.log(`[botshub] Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

/**
 * Handle incoming BotsHub message
 */
function handleMessage(msg) {
  const type = msg.type;

  if (type === 'message') {
    // DM or channel message from another agent
    // Actual format: { type: "message", channel_id, message: { content, ... }, sender_name }
    const sender = msg.sender_name || 'unknown';
    const content = msg.message?.content || msg.content || '';

    // Ignore own messages
    if (sender === AGENT_NAME) return;

    console.log(`[botshub] Message from ${sender}: ${content.substring(0, 80)}`);

    const formatted = `[BotsHub DM] ${sender} said: ${content}`;
    sendToC4('botshub', sender, formatted);

  } else if (type === 'channel_message') {
    // Group channel message (alternative format)
    const sender = msg.sender_name || 'unknown';
    const channel = msg.channel_id || 'unknown';
    const channelName = msg.channel_name || channel;
    const content = msg.message?.content || msg.content || '';

    // Ignore own messages
    if (sender === AGENT_NAME) return;

    console.log(`[botshub] Channel ${channelName} from ${sender}: ${content.substring(0, 80)}`);

    const formatted = `[BotsHub GROUP:${channelName}] ${sender} said: ${content}`;
    sendToC4('botshub', `channel:${channel}`, formatted);

  } else if (type === 'ping') {
    // Respond to keepalive
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pong' }));
    }

  } else {
    console.log(`[botshub] Unknown message type: ${type}`, JSON.stringify(msg).substring(0, 200));
  }
}

// Start
console.log(`[botshub] zylos-botshub starting as "${AGENT_NAME}"`);
console.log(`[botshub] Hub: ${HUB_URL}`);
console.log(`[botshub] Proxy: ${PROXY_URL || 'none'}`);
connect();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('[botshub] Shutting down...');
  if (ws) ws.close();
  process.exit(0);
});
process.once('SIGTERM', () => {
  console.log('[botshub] Shutting down...');
  if (ws) ws.close();
  process.exit(0);
});

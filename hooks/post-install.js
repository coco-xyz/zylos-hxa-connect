#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/botshub');
const ENV_PATH = path.join(HOME, 'zylos/.env');

// 1. Create data subdirectories
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
console.log('[post-install] Created data directories');

// 2. Load .env
function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_PATH)) return env;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return env;
}

const env = loadEnv();
const HUB_URL = env.BOTSHUB_URL || '';
const ORG_KEY = env.BOTSHUB_ORG_KEY || '';
const AGENT_NAME = env.BOTSHUB_AGENT_NAME || '';
const PROXY_URL = env.HTTPS_PROXY || env.HTTP_PROXY || '';

// 3. Check if config already has a valid agent_token (re-install / upgrade scenario)
const configPath = path.join(DATA_DIR, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (existing.agent_token) {
      console.log('[post-install] config.json already has agent_token, skipping registration');
      console.log('[post-install] Complete!');
      process.exit(0);
    }
  } catch {}
}

// 4. Validate required env vars
if (!HUB_URL) {
  console.error('[post-install] BOTSHUB_URL not set in .env');
  process.exit(1);
}
if (!ORG_KEY) {
  console.error('[post-install] BOTSHUB_ORG_KEY not set in .env');
  process.exit(1);
}
if (!AGENT_NAME) {
  console.error('[post-install] BOTSHUB_AGENT_NAME not set in .env');
  process.exit(1);
}

// 5. Register agent via BotsHub API
function register() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${HUB_URL}/api/register`);
    const body = JSON.stringify({ name: AGENT_NAME, display_name: AGENT_NAME });
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ORG_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    // Proxy support
    if (PROXY_URL) {
      const proxyUrl = new URL(PROXY_URL);
      const connectOptions = {
        hostname: proxyUrl.hostname,
        port: proxyUrl.port || 80,
        method: 'CONNECT',
        path: `${url.hostname}:${url.port || 443}`
      };
      const proxyReq = http.request(connectOptions);
      proxyReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
          return;
        }
        const req = https.request({ ...options, socket, agent: false }, handleResponse(resolve, reject));
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      proxyReq.on('error', reject);
      proxyReq.end();
      return;
    }

    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(options, handleResponse(resolve, reject));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function handleResponse(resolve, reject) {
  return (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      } else {
        reject(new Error(`Registration failed (${res.statusCode}): ${data}`));
      }
    });
  };
}

try {
  console.log(`[post-install] Registering agent "${AGENT_NAME}" at ${HUB_URL}...`);
  const result = await register();

  const config = {
    hub_url: HUB_URL,
    agent_id: result.agent_id || result.id || '',
    agent_token: result.token || '',
    agent_name: AGENT_NAME,
    display_name: AGENT_NAME
  };

  if (!config.agent_token) {
    console.error('[post-install] Registration succeeded but no token returned:', JSON.stringify(result));
    process.exit(1);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`[post-install] Registered successfully. Agent ID: ${config.agent_id}`);
  console.log('[post-install] Complete!');
} catch (err) {
  console.error(`[post-install] Registration failed: ${err.message}`);
  process.exit(1);
}

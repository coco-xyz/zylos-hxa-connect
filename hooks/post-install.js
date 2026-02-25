#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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
const ORG_ID = env.BOTSHUB_ORG_ID || '';
const ORG_TICKET = env.BOTSHUB_ORG_TICKET || '';
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
if (!ORG_ID) {
  console.error('[post-install] BOTSHUB_ORG_ID not set in .env');
  process.exit(1);
}
if (!ORG_TICKET) {
  console.error('[post-install] BOTSHUB_ORG_TICKET not set in .env');
  process.exit(1);
}
if (!AGENT_NAME) {
  console.error('[post-install] BOTSHUB_AGENT_NAME not set in .env');
  process.exit(1);
}

// 5. Set up proxy for fetch if needed
if (PROXY_URL) {
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
    console.log(`[post-install] Using proxy: ${PROXY_URL}`);
  } catch {
    console.warn('[post-install] Could not set up fetch proxy — undici not available');
  }
}

// 6. Register agent via ticket-based auth (POST /api/auth/register)
try {
  console.log(`[post-install] Registering agent "${AGENT_NAME}" at ${HUB_URL}...`);

  const resp = await fetch(`${HUB_URL.replace(/\/$/, '')}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      org_id: ORG_ID,
      ticket: ORG_TICKET,
      name: AGENT_NAME,
      display_name: AGENT_NAME,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Registration failed (${resp.status}): ${body}`);
  }

  const result = await resp.json();

  const config = {
    hub_url: HUB_URL,
    org_id: ORG_ID,
    agent_id: result.agent_id || result.id || '',
    agent_token: result.token || '',
    agent_name: AGENT_NAME,
    display_name: AGENT_NAME,
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

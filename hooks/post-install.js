#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/hxa-connect');
const ENV_PATH = path.join(HOME, 'zylos/.env');
const configPath = path.join(DATA_DIR, 'config.json');

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
const HUB_URL = env.HXA_CONNECT_URL || '';
const ORG_ID = env.HXA_CONNECT_ORG_ID || '';
const ORG_TICKET = env.HXA_CONNECT_ORG_TICKET || '';
const AGENT_NAME = env.HXA_CONNECT_AGENT_NAME || '';
const PROXY_URL = env.HTTPS_PROXY || env.HTTP_PROXY || '';

// 3. Check if config already has valid credentials (re-install / upgrade scenario)
//    Handles both old format (agent_token at top level) and new format (orgs map)
if (fs.existsSync(configPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // New multi-org format: check any org has a token
    if (existing.orgs) {
      const hasToken = Object.values(existing.orgs).some(o => o.agent_token);
      if (hasToken) {
        console.log('[post-install] config.json already has orgs with credentials, skipping registration');
        console.log('[post-install] Complete!');
        process.exit(0);
      }
    }
    // Old single-org format: check top-level token
    if (existing.agent_token) {
      console.log('[post-install] config.json already has agent_token, skipping registration');
      console.log('[post-install] Complete!');
      process.exit(0);
    }
  } catch {}
}

// 4. Validate required env vars
if (!HUB_URL) {
  console.error('[post-install] HXA_CONNECT_URL not set in .env');
  process.exit(1);
}
if (!ORG_ID) {
  console.error('[post-install] HXA_CONNECT_ORG_ID not set in .env');
  process.exit(1);
}
if (!ORG_TICKET) {
  console.error('[post-install] HXA_CONNECT_ORG_TICKET not set in .env');
  process.exit(1);
}
if (!AGENT_NAME) {
  console.error('[post-install] HXA_CONNECT_AGENT_NAME not set in .env');
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
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Registration failed (${resp.status}): ${body}`);
  }

  const result = await resp.json();
  const agentToken = result.token || '';
  const agentId = result.agent_id || result.id || '';

  if (!agentToken) {
    console.error('[post-install] Registration succeeded but no token returned:', JSON.stringify(result));
    process.exit(1);
  }

  // Write new multi-org config format directly
  const config = {
    default_hub_url: HUB_URL,
    orgs: {
      default: {
        org_id: ORG_ID,
        agent_id: agentId,
        agent_token: agentToken,
        agent_name: AGENT_NAME,
        hub_url: null,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`[post-install] Registered successfully. Agent ID: ${agentId}`);
  console.log('[post-install] Complete!');
} catch (err) {
  console.error(`[post-install] Registration failed: ${err.message}`);
  process.exit(1);
}

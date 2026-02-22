/**
 * Shared environment and config loader for zylos-botshub.
 * Loads .env, reads config.json, and sets up HTTP proxy for fetch().
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const CONFIG_PATH = path.join(HOME, 'zylos/components/botshub/config.json');
const ENV_PATH = path.join(HOME, 'zylos/.env');

// Load .env into process.env (don't override existing vars)
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

export const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[botshub] Failed to load config:', err.message);
    process.exit(1);
  }
}

/**
 * Set up HTTP proxy for native fetch() calls (used by botshub-sdk).
 * Must be called before any SDK HTTP operations.
 */
export async function setupFetchProxy() {
  if (!PROXY_URL) return;
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  } catch {
    console.warn('[botshub] Could not set up fetch proxy — undici not available');
  }
}

/**
 * Shared environment and config loader for zylos-hxa-connect.
 * Loads .env, reads config.json, and sets up HTTP proxy for fetch().
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const CONFIG_PATH = path.join(HOME, 'zylos/components/hxa-connect/config.json');
const ENV_PATH = path.join(HOME, 'zylos/.env');

const LABEL_RE = /^[a-z0-9][a-z0-9-]*$/;

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
    console.error('[hxa-connect] Failed to load config:', err.message);
    process.exit(1);
  }
}

/**
 * Migrate old single-org config format to new multi-org format.
 * Idempotent — already-new config is a no-op.
 */
export function migrateConfig() {
  const config = loadConfig();

  if (config.orgs) return config;
  if (!config.org_id) {
    throw new Error('Config has no orgs and no org_id — add at least one org to config.json');
  }

  console.log('[hxa-connect] Migrating config from single-org to multi-org format');

  const backupPath = CONFIG_PATH + '.bak';
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`[hxa-connect] Backup written to ${backupPath}`);
  }

  const migrated = {
    default_hub_url: config.hub_url || null,
    orgs: {
      default: {
        org_id: config.org_id,
        agent_id: config.agent_id || null,
        agent_token: config.agent_token,
        agent_name: config.agent_name,
        hub_url: null,
      },
    },
  };

  const tmpPath = CONFIG_PATH + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(migrated, null, 2) + '\n');
  fs.renameSync(tmpPath, CONFIG_PATH);
  console.log('[hxa-connect] Config migrated successfully');

  return migrated;
}

/**
 * Resolve config into normalized multi-org structure.
 * Returns { defaultHubUrl, orgs: { [label]: { orgId, agentId, agentToken, agentName, hubUrl } } }
 */
export function resolveOrgs(config) {
  if (!config.orgs) {
    throw new Error('Config not in multi-org format. Run migrateConfig() first.');
  }

  const defaultHubUrl = config.default_hub_url || null;
  const orgs = {};

  for (const [label, org] of Object.entries(config.orgs)) {
    if (!LABEL_RE.test(label)) {
      throw new Error(`Invalid org label "${label}" — must match /^[a-z0-9][a-z0-9-]*$/`);
    }
    if (!org.org_id) throw new Error(`Org "${label}": org_id is required`);
    if (!org.agent_token) throw new Error(`Org "${label}": agent_token is required`);
    if (!org.agent_name) throw new Error(`Org "${label}": agent_name is required`);

    orgs[label] = {
      orgId: org.org_id,
      agentId: org.agent_id || null,
      agentToken: org.agent_token,
      agentName: org.agent_name,
      hubUrl: org.hub_url || defaultHubUrl,
    };
  }

  if (Object.keys(orgs).length === 0) {
    throw new Error('No orgs defined in config');
  }

  return { defaultHubUrl, orgs };
}

/**
 * Set up HTTP proxy for native fetch() calls (used by hxa-connect-sdk).
 * Must be called before any SDK HTTP operations.
 */
export async function setupFetchProxy() {
  if (!PROXY_URL) return;
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  } catch {
    console.warn('[hxa-connect] Could not set up fetch proxy — undici not available');
  }
}

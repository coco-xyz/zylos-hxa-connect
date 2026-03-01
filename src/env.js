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
const ACCESS_KEYS = ['dmPolicy', 'dmAllowFrom', 'groupPolicy', 'channels'];

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
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    console.error(`[hxa-connect] Cannot read config at ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[hxa-connect] Config is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

function atomicWrite(filePath, data) {
  const tmpPath = filePath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Migrate config to current format. Two phases, both idempotent:
 * 1. Single-org → multi-org (old flat format → orgs map)
 * 2. Global access → per-org access (top-level dmPolicy etc. → orgs.*.access)
 */
export function migrateConfig() {
  const config = loadConfig();
  let changed = false;

  // Phase 1: single-org → multi-org
  if (!config.orgs) {
    if (!config.org_id) {
      throw new Error('Config has no orgs and no org_id — add at least one org to config.json');
    }

    console.log('[hxa-connect] Migrating config from single-org to multi-org format');

    const backupPath = CONFIG_PATH + '.bak';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`[hxa-connect] Backup written to ${backupPath}`);
    }

    // Extract org fields, preserve everything else
    const { hub_url, org_id, agent_id, agent_token, agent_name, ...rest } = config;

    // Extract access fields from rest into per-org access
    const access = {};
    for (const key of ACCESS_KEYS) {
      if (key in rest) {
        access[key] = rest[key];
        delete rest[key];
      }
    }

    // Clear old flat keys from config
    for (const k of ['hub_url', 'org_id', 'agent_id', 'agent_token', 'agent_name']) {
      delete config[k];
    }
    // Remove access keys already extracted into `access`
    for (const k of ACCESS_KEYS) delete config[k];
    // Remove any stale orgs/default_hub_url from rest to prevent overwriting
    delete rest.orgs;
    delete rest.default_hub_url;

    config.default_hub_url = hub_url || null;
    config.orgs = {
      default: {
        org_id,
        agent_id: agent_id || null,
        agent_token,
        agent_name,
        hub_url: null,
        ...(Object.keys(access).length > 0 ? { access } : {}),
      },
    };
    // Preserve remaining unknown top-level keys
    Object.assign(config, rest);
    changed = true;
  }

  // Phase 2: global access → per-org access
  const globalAccess = {};
  for (const key of ACCESS_KEYS) {
    if (key in config) {
      globalAccess[key] = config[key];
    }
  }

  if (Object.keys(globalAccess).length > 0) {
    console.log('[hxa-connect] Migrating global access fields to per-org access');
    for (const org of Object.values(config.orgs)) {
      if (!org.access) org.access = {};
      // Merge per-field: only backfill missing keys, don't overwrite existing
      for (const [key, val] of Object.entries(globalAccess)) {
        if (!(key in org.access)) {
          org.access[key] = val;
        }
      }
    }
    for (const key of ACCESS_KEYS) {
      delete config[key];
    }
    changed = true;
  }

  if (changed) {
    atomicWrite(CONFIG_PATH, config);
    console.log('[hxa-connect] Config migrated successfully');
  }

  return config;
}

/**
 * Resolve config into normalized multi-org structure.
 * Returns { defaultHubUrl, orgs: { [label]: { orgId, agentId, agentToken, agentName, hubUrl, access } } }
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
      access: org.access || {},
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

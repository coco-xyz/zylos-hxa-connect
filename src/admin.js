#!/usr/bin/env node
/**
 * zylos-hxa-connect admin CLI
 * Manage per-org DM and thread (group) access control.
 *
 * Usage: node admin.js [--org <label>] <command> [args]
 *
 * --org selects which org's access config to modify.
 * Without --org: uses "default" if it exists, otherwise the first (or only) org.
 */

import { loadConfig, saveConfig } from './lib/config.js';

// ─── Arg parsing ─────────────────────────────────────────

const VALUE_FLAGS = new Set(['--org']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    if (VALUE_FLAGS.has(argv[i]) && i + 1 < argv.length) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i += 2;
    } else if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = true;
      i++;
    } else {
      positional.push(argv[i]);
      i++;
    }
  }
  return { flags, positional };
}

// ─── Org resolution ──────────────────────────────────────

function resolveOrgLabel(config, requestedLabel) {
  if (!config.orgs || Object.keys(config.orgs).length === 0) {
    console.error('No orgs configured');
    process.exit(1);
  }
  const labels = Object.keys(config.orgs);
  if (requestedLabel) {
    if (!config.orgs[requestedLabel]) {
      console.error(`Org "${requestedLabel}" not found. Available: ${labels.join(', ')}`);
      process.exit(1);
    }
    return requestedLabel;
  }
  // Default: "default" if exists, otherwise first
  return labels.includes('default') ? 'default' : labels[0];
}

function getOrgAccess(config, label) {
  if (!config.orgs[label].access) config.orgs[label].access = {};
  return config.orgs[label].access;
}

// ─── Commands ────────────────────────────────────────────

const commands = {
  show: (config) => {
    console.log(JSON.stringify(config, null, 2));
  },

  // ─── DM Policy ─────────────────────────────────────────

  'set-dm-policy': (config, label, policy) => {
    const valid = ['open', 'allowlist'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-dm-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const access = getOrgAccess(config, label);
    access.dmPolicy = policy;
    if (!saveConfig(config)) process.exit(1);
    const desc = { open: 'Anyone can DM', allowlist: 'Only dmAllowFrom senders can DM' };
    console.log(`[${label}] DM policy set to: ${policy} (${desc[policy]})`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'list-dm-allow': (config, label) => {
    const access = getOrgAccess(config, label);
    console.log(`[${label}] DM policy: ${access.dmPolicy || 'open'}`);
    const allowFrom = access.dmAllowFrom || [];
    console.log(`[${label}] DM allowFrom (${allowFrom.length}):`, allowFrom.length ? allowFrom.join(', ') : 'none');
  },

  'add-dm-allow': (config, label, value) => {
    if (!value) {
      console.error('Usage: admin.js add-dm-allow <sender_name>');
      process.exit(1);
    }
    const access = getOrgAccess(config, label);
    if (!Array.isArray(access.dmAllowFrom)) access.dmAllowFrom = [];
    const lower = value.toLowerCase();
    if (!access.dmAllowFrom.some(a => String(a).toLowerCase() === lower)) {
      access.dmAllowFrom.push(value);
      if (!saveConfig(config)) process.exit(1);
      console.log(`[${label}] Added ${value} to dmAllowFrom`);
    } else {
      console.log(`[${label}] ${value} already in dmAllowFrom`);
    }
    if ((access.dmPolicy || 'open') !== 'allowlist') {
      console.log(`Note: dmPolicy is "${access.dmPolicy || 'open'}", set to "allowlist" for this to take effect.`);
    }
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'remove-dm-allow': (config, label, value) => {
    if (!value) {
      console.error('Usage: admin.js remove-dm-allow <sender_name>');
      process.exit(1);
    }
    const access = getOrgAccess(config, label);
    if (!Array.isArray(access.dmAllowFrom)) {
      console.log(`[${label}] ${value} not found in dmAllowFrom`);
      return;
    }
    const lower = value.toLowerCase();
    const removed = access.dmAllowFrom.filter(a => String(a).toLowerCase() === lower);
    if (removed.length) {
      access.dmAllowFrom = access.dmAllowFrom.filter(a => String(a).toLowerCase() !== lower);
      if (!saveConfig(config)) process.exit(1);
      console.log(`[${label}] Removed from dmAllowFrom: ${removed.join(', ')}`);
    } else {
      console.log(`[${label}] ${value} not found in dmAllowFrom`);
    }
  },

  // ─── Group Policy (Thread Access) ──────────────────────

  'set-group-policy': (config, label, policy) => {
    const valid = ['open', 'allowlist', 'disabled'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-group-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const access = getOrgAccess(config, label);
    access.groupPolicy = policy;
    if (!saveConfig(config)) process.exit(1);
    console.log(`[${label}] Group policy set to: ${policy}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'list-threads': (config, label) => {
    const access = getOrgAccess(config, label);
    const threads = access.threads || {};
    const ids = Object.keys(threads);

    console.log(`[${label}] Group policy: ${access.groupPolicy || 'open'}`);
    if (ids.length === 0) {
      console.log(`[${label}] No threads configured`);
      return;
    }

    ids.forEach(threadId => {
      const th = threads[threadId];
      const allowFrom = Array.isArray(th.allowFrom) && th.allowFrom.length > 0
        ? th.allowFrom.join(', ')
        : '*';
      console.log(`  ${threadId} - ${th.name || 'thread'}`);
      console.log(`    allowFrom: ${allowFrom}`);
      console.log(`    added_at: ${th.added_at || 'unknown'}`);
    });
  },

  'add-thread': (config, label, threadId, name) => {
    if (!threadId || !name) {
      console.error('Usage: admin.js add-thread <thread_id> <name>');
      process.exit(1);
    }

    const access = getOrgAccess(config, label);
    if (!access.threads) access.threads = {};
    if (access.threads[threadId]) {
      console.log(`[${label}] Thread ${threadId} already configured`);
      return;
    }

    access.threads[threadId] = {
      name,
      allowFrom: ['*'],
      added_at: new Date().toISOString(),
    };
    if (!saveConfig(config)) process.exit(1);
    console.log(`[${label}] Added thread: ${threadId} (${name})`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'remove-thread': (config, label, threadId) => {
    if (!threadId) {
      console.error('Usage: admin.js remove-thread <thread_id>');
      process.exit(1);
    }

    const access = getOrgAccess(config, label);
    if (!access.threads?.[threadId]) {
      console.error(`[${label}] Thread ${threadId} not found`);
      process.exit(1);
    }
    delete access.threads[threadId];
    if (!saveConfig(config)) process.exit(1);
    console.log(`[${label}] Removed thread: ${threadId}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  // ─── Thread Mode ─────────────────────────────────────

  'set-thread-mode': (config, label, mode) => {
    const valid = ['mention', 'smart'];
    mode = String(mode || '').trim().toLowerCase();
    if (!valid.includes(mode)) {
      console.error(`Usage: admin.js set-thread-mode <${valid.join('|')}>`);
      process.exit(1);
    }
    const access = getOrgAccess(config, label);
    access.threadMode = mode;
    if (!saveConfig(config)) process.exit(1);
    const desc = {
      mention: '@mention only — bot responds when explicitly mentioned',
      smart: 'All messages delivered — AI decides whether to respond',
    };
    console.log(`[${label}] Thread mode set to: ${mode} (${desc[mode]})`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'show-thread-mode': (config, label) => {
    const access = getOrgAccess(config, label);
    console.log(`[${label}] Thread mode: ${access.threadMode || 'mention'} (default: mention)`);
  },

  'set-thread-allowfrom': (config, label, threadId, ...senders) => {
    if (!threadId || senders.length === 0) {
      console.error('Usage: admin.js set-thread-allowfrom <thread_id> <sender_names...>');
      process.exit(1);
    }

    const access = getOrgAccess(config, label);
    if (!access.threads?.[threadId]) {
      console.error(`[${label}] Thread ${threadId} not found`);
      process.exit(1);
    }

    access.threads[threadId].allowFrom = senders;
    if (!saveConfig(config)) process.exit(1);
    console.log(`[${label}] Set allowFrom for ${threadId}: ${senders.join(', ')}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  help: () => {
    console.log(`
zylos-hxa-connect admin CLI

Usage: node admin.js [--org <label>] <command> [args]

--org selects which org to manage (default: "default" or first org)

Commands:
  show                                             Show full config

  DM Access Control (per-org):
  set-dm-policy <open|allowlist>                   Set DM policy
  list-dm-allow                                    Show DM policy and allowFrom list
  add-dm-allow <sender_name>                       Add sender to dmAllowFrom
  remove-dm-allow <sender_name>                    Remove sender from dmAllowFrom

  Thread (Group) Access Control (per-org):
  set-group-policy <open|allowlist|disabled>        Set thread access policy
  list-threads                                      List all configured threads
  add-thread <thread_id> <name>                     Add thread to allowlist
  remove-thread <thread_id>                         Remove thread
  set-thread-allowfrom <thread_id> <senders...>     Set allowed senders (use * for all)

  Thread Mode (per-org):
  set-thread-mode <mention|smart>                    Set thread response mode
  show-thread-mode                                   Show current thread mode

  help                                              Show this help

Permission flow (evaluated per-org):
  DM:      dmPolicy (open|allowlist) + dmAllowFrom
  Threads: groupPolicy (open|allowlist|disabled) + threads map + per-thread allowFrom
           threadMode (mention|smart) — mention = @mention only, smart = all messages delivered

After changes, restart: pm2 restart zylos-hxa-connect
`);
  },
};

// ─── Main ────────────────────────────────────────────────

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0] || 'help';

if (command === 'help' || !commands[command]) {
  if (!commands[command] && command !== 'help') {
    console.error(`Unknown command: ${command}`);
  }
  commands.help();
  if (!commands[command]) process.exit(1);
} else {
  const config = loadConfig();
  const label = resolveOrgLabel(config, flags.org);
  commands[command](config, label, ...positional.slice(1));
}

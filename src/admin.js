#!/usr/bin/env node
/**
 * zylos-hxa-connect admin CLI
 * Manage DM and channel (group) access control.
 *
 * Usage: node admin.js <command> [args]
 */

import { loadConfig, saveConfig } from './lib/config.js';

const commands = {
  show: () => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  },

  // ─── DM Policy ─────────────────────────────────────────

  'set-dm-policy': (policy) => {
    const valid = ['open', 'allowlist'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-dm-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.dmPolicy = policy;
    if (!saveConfig(config)) process.exit(1);
    const desc = { open: 'Anyone can DM', allowlist: 'Only dmAllowFrom senders can DM' };
    console.log(`DM policy set to: ${policy} (${desc[policy]})`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'list-dm-allow': () => {
    const config = loadConfig();
    console.log(`DM policy: ${config.dmPolicy || 'open'}`);
    const allowFrom = config.dmAllowFrom || [];
    console.log(`DM allowFrom (${allowFrom.length}):`, allowFrom.length ? allowFrom.join(', ') : 'none');
  },

  'add-dm-allow': (value) => {
    if (!value) {
      console.error('Usage: admin.js add-dm-allow <sender_name>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
    const lower = value.toLowerCase();
    if (!config.dmAllowFrom.some(a => a.toLowerCase() === lower)) {
      config.dmAllowFrom.push(value);
      if (!saveConfig(config)) process.exit(1);
      console.log(`Added ${value} to dmAllowFrom`);
    } else {
      console.log(`${value} already in dmAllowFrom`);
    }
    if ((config.dmPolicy || 'open') !== 'allowlist') {
      console.log(`Note: dmPolicy is "${config.dmPolicy || 'open'}", set to "allowlist" for this to take effect.`);
    }
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'remove-dm-allow': (value) => {
    if (!value) {
      console.error('Usage: admin.js remove-dm-allow <sender_name>');
      process.exit(1);
    }
    const config = loadConfig();
    if (!Array.isArray(config.dmAllowFrom)) {
      console.log(`${value} not found in dmAllowFrom`);
      return;
    }
    const lower = value.toLowerCase();
    const removed = config.dmAllowFrom.filter(a => a.toLowerCase() === lower);
    if (removed.length) {
      config.dmAllowFrom = config.dmAllowFrom.filter(a => a.toLowerCase() !== lower);
      if (!saveConfig(config)) process.exit(1);
      console.log(`Removed from dmAllowFrom: ${removed.join(', ')}`);
    } else {
      console.log(`${value} not found in dmAllowFrom`);
    }
  },

  // ─── Group/Channel Policy ──────────────────────────────

  'set-group-policy': (policy) => {
    const valid = ['open', 'allowlist', 'disabled'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-group-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.groupPolicy = policy;
    if (!saveConfig(config)) process.exit(1);
    console.log(`Group policy set to: ${policy}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'list-channels': () => {
    const config = loadConfig();
    const channels = config.channels || {};
    const ids = Object.keys(channels);

    console.log(`Group policy: ${config.groupPolicy || 'open'}`);
    if (ids.length === 0) {
      console.log('No channels configured');
      return;
    }

    ids.forEach(chanId => {
      const ch = channels[chanId];
      const allowFrom = Array.isArray(ch.allowFrom) && ch.allowFrom.length > 0
        ? ch.allowFrom.join(', ')
        : '*';
      console.log(`  ${chanId} - ${ch.name || 'channel'}`);
      console.log(`    allowFrom: ${allowFrom}`);
      console.log(`    added_at: ${ch.added_at || 'unknown'}`);
    });
  },

  'add-channel': (channelId, name) => {
    if (!channelId || !name) {
      console.error('Usage: admin.js add-channel <channel_id> <name>');
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.channels) config.channels = {};
    if (config.channels[channelId]) {
      console.log(`Channel ${channelId} already configured`);
      return;
    }

    config.channels[channelId] = {
      name,
      allowFrom: ['*'],
      added_at: new Date().toISOString(),
    };
    if (!saveConfig(config)) process.exit(1);
    console.log(`Added channel: ${channelId} (${name})`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'remove-channel': (channelId) => {
    if (!channelId) {
      console.error('Usage: admin.js remove-channel <channel_id>');
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.channels?.[channelId]) {
      console.error(`Channel ${channelId} not found`);
      process.exit(1);
    }
    delete config.channels[channelId];
    if (!saveConfig(config)) process.exit(1);
    console.log(`Removed channel: ${channelId}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  'set-channel-allowfrom': (channelId, ...senders) => {
    if (!channelId || senders.length === 0) {
      console.error('Usage: admin.js set-channel-allowfrom <channel_id> <sender_names...>');
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.channels?.[channelId]) {
      console.error(`Channel ${channelId} not found`);
      process.exit(1);
    }

    config.channels[channelId].allowFrom = senders;
    if (!saveConfig(config)) process.exit(1);
    console.log(`Set allowFrom for ${channelId}: ${senders.join(', ')}`);
    console.log('Run: pm2 restart zylos-hxa-connect');
  },

  help: () => {
    console.log(`
zylos-hxa-connect admin CLI

Commands:
  show                                             Show full config

  DM Access Control:
  set-dm-policy <open|allowlist>                   Set DM policy
  list-dm-allow                                    Show DM policy and allowFrom list
  add-dm-allow <sender_name>                       Add sender to dmAllowFrom
  remove-dm-allow <sender_name>                    Remove sender from dmAllowFrom

  Channel (Group) Access Control:
  set-group-policy <open|allowlist|disabled>        Set channel policy
  list-channels                                     List all configured channels
  add-channel <channel_id> <name>                   Add channel to allowlist
  remove-channel <channel_id>                       Remove channel
  set-channel-allowfrom <channel_id> <senders...>   Set allowed senders (use * for all)

  help                                              Show this help

Permission flow:
  DM:      dmPolicy (open|allowlist) + dmAllowFrom
  Channel: groupPolicy (open|allowlist|disabled) + channels map + per-channel allowFrom
  Threads: @mention filter via SDK ThreadContext (no additional policy)

After changes, restart: pm2 restart zylos-hxa-connect
`);
  },
};

// Main
const args = process.argv.slice(2);
const command = args[0] || 'help';

if (commands[command]) {
  commands[command](...args.slice(1));
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}

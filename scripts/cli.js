#!/usr/bin/env node
/**
 * zylos-hxa-connect CLI — exposes SDK capabilities as subcommands.
 *
 * Usage:
 *   node cli.js <command> [options]
 *
 * All output is JSON for easy parsing by Claude.
 * Message sending is NOT here — it goes through C4 (c4-send.js → send.js).
 */

import { HxaConnectClient } from '@coco-xyz/hxa-connect-sdk';
import { loadConfig, setupFetchProxy } from '../src/env.js';

const config = loadConfig();

if (!config.hub_url || !config.agent_token) {
  console.error(JSON.stringify({ error: 'hub_url and agent_token required in config.json' }));
  process.exit(1);
}
if (!config.org_id) {
  console.error(JSON.stringify({ error: 'org_id required in config.json' }));
  process.exit(1);
}

await setupFetchProxy();

const client = new HxaConnectClient({
  url: config.hub_url,
  token: config.agent_token,
  orgId: config.org_id,
});

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function out(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}

try {
  switch (command) {
    // ─── Query ──────────────────────────────────────────────

    case 'peers': {
      const peers = await client.listPeers();
      out(peers);
      break;
    }

    case 'threads': {
      const status = getFlag('status');
      const threads = await client.listThreads(status ? { status } : undefined);
      out(threads);
      break;
    }

    case 'thread': {
      const id = args[1];
      if (!id) fail('Usage: cli.js thread <thread_id>');
      const thread = await client.getThread(id);
      out(thread);
      break;
    }

    case 'messages': {
      const id = args[1];
      if (!id) fail('Usage: cli.js messages <thread_id> [--limit N] [--since TS] [--before TS]');
      const limit = getFlag('limit');
      const since = getFlag('since');
      const before = getFlag('before');
      const opts = {};
      if (limit) opts.limit = Number(limit);
      if (since) opts.since = Number(since);
      if (before) opts.before = Number(before);
      const messages = await client.getThreadMessages(id, opts);
      out(messages);
      break;
    }

    case 'profile': {
      const profile = await client.getProfile();
      out(profile);
      break;
    }

    case 'org': {
      const info = await client.getOrgInfo();
      out(info);
      break;
    }

    case 'catchup': {
      const since = getFlag('since');
      if (!since) fail('Usage: cli.js catchup --since <timestamp_ms>');
      const cursor = getFlag('cursor');
      const limit = getFlag('limit');
      const opts = { since: Number(since) };
      if (cursor) opts.cursor = cursor;
      if (limit) opts.limit = Number(limit);
      const events = await client.catchup(opts);
      out(events);
      break;
    }

    case 'catchup-count': {
      const since = getFlag('since');
      if (!since) fail('Usage: cli.js catchup-count --since <timestamp_ms>');
      const counts = await client.catchupCount({ since: Number(since) });
      out(counts);
      break;
    }

    case 'inbox': {
      const since = getFlag('since');
      if (!since) fail('Usage: cli.js inbox --since <timestamp_ms>');
      const messages = await client.inbox(Number(since));
      out(messages);
      break;
    }

    // ─── Thread Operations ──────────────────────────────────

    case 'thread-create': {
      const topic = args[1];
      if (!topic) fail('Usage: cli.js thread-create "topic" [--tags a,b] [--participants bot1,bot2] [--context "..."]');
      const opts = { topic };
      const tags = getFlag('tags');
      const participants = getFlag('participants');
      const context = getFlag('context');
      if (tags) opts.tags = tags.split(',');
      if (participants) opts.participants = participants.split(',');
      if (context) opts.context = context;
      const thread = await client.createThread(opts);
      out(thread);
      break;
    }

    case 'thread-update': {
      const id = args[1];
      if (!id) fail('Usage: cli.js thread-update <thread_id> [--status active|blocked|reviewing|resolved|closed] [--topic "..."] [--close-reason manual|timeout|error]');
      const updates = {};
      const status = getFlag('status');
      const topic = getFlag('topic');
      const closeReason = getFlag('close-reason');
      const context = getFlag('context');
      if (status) updates.status = status;
      if (topic) updates.topic = topic;
      if (closeReason) updates.close_reason = closeReason;
      if (context) updates.context = context;
      if (Object.keys(updates).length === 0) fail('No updates specified');
      const thread = await client.updateThread(id, updates);
      out(thread);
      break;
    }

    case 'thread-invite': {
      const threadId = args[1];
      const botId = args[2];
      if (!threadId || !botId) fail('Usage: cli.js thread-invite <thread_id> <bot_name_or_id> [--label "role"]');
      const label = getFlag('label');
      const result = await client.invite(threadId, botId, label);
      out(result);
      break;
    }

    case 'thread-join': {
      const threadId = args[1];
      if (!threadId) fail('Usage: cli.js thread-join <thread_id>');
      const result = await client.joinThread(threadId);
      out(result);
      break;
    }

    case 'thread-leave': {
      const threadId = args[1];
      if (!threadId) fail('Usage: cli.js thread-leave <thread_id>');
      await client.leave(threadId);
      out({ ok: true });
      break;
    }

    // ─── Artifacts ──────────────────────────────────────────

    case 'artifact-add': {
      const threadId = args[1];
      const key = args[2];
      if (!threadId || !key) fail('Usage: cli.js artifact-add <thread_id> <key> --type markdown|code|text|link --title "..." [--body "..."] [--url "..."] [--language js]');
      const type = getFlag('type');
      if (!type) fail('--type is required (markdown, code, text, link)');
      const artifact = { type };
      const title = getFlag('title');
      const body = getFlag('body');
      const url = getFlag('url');
      const language = getFlag('language');
      if (title) artifact.title = title;
      if (body) artifact.content = body;
      if (url) artifact.url = url;
      if (language) artifact.language = language;
      // Support reading body from stdin if --stdin flag is present
      if (hasFlag('stdin')) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        artifact.content = Buffer.concat(chunks).toString('utf8');
      }
      const result = await client.addArtifact(threadId, key, artifact);
      out(result);
      break;
    }

    case 'artifact-update': {
      const threadId = args[1];
      const key = args[2];
      if (!threadId || !key) fail('Usage: cli.js artifact-update <thread_id> <key> --body "..." [--title "..."]');
      const updates = {};
      const body = getFlag('body');
      const title = getFlag('title');
      if (hasFlag('stdin')) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        updates.content = Buffer.concat(chunks).toString('utf8');
      } else if (body) {
        updates.content = body;
      } else {
        fail('--body or --stdin required');
      }
      if (title) updates.title = title;
      const result = await client.updateArtifact(threadId, key, updates);
      out(result);
      break;
    }

    case 'artifact-list': {
      const threadId = args[1];
      if (!threadId) fail('Usage: cli.js artifact-list <thread_id>');
      const artifacts = await client.listArtifacts(threadId);
      out(artifacts);
      break;
    }

    case 'artifact-versions': {
      const threadId = args[1];
      const key = args[2];
      if (!threadId || !key) fail('Usage: cli.js artifact-versions <thread_id> <key>');
      const versions = await client.getArtifactVersions(threadId, key);
      out(versions);
      break;
    }

    // ─── Profile ────────────────────────────────────────────

    case 'profile-update': {
      const fields = {};
      const bio = getFlag('bio');
      const role = getFlag('role');
      const team = getFlag('team');
      const status = getFlag('status-text');
      const timezone = getFlag('timezone');
      if (bio) fields.bio = bio;
      if (role) fields.role = role;
      if (team) fields.team = team;
      if (status) fields.status_text = status;
      if (timezone) fields.timezone = timezone;
      if (Object.keys(fields).length === 0) fail('No fields specified. Use --bio, --role, --team, --status-text, --timezone');
      const profile = await client.updateProfile(fields);
      out(profile);
      break;
    }

    case 'rename': {
      const name = args[1];
      if (!name) fail('Usage: cli.js rename <new_name>');
      const result = await client.rename(name);
      out(result);
      break;
    }

    // ─── Admin ──────────────────────────────────────────────

    case 'role': {
      const botId = args[1];
      const role = args[2];
      if (!botId || !role) fail('Usage: cli.js role <bot_id_or_name> admin|member');
      if (role !== 'admin' && role !== 'member') fail('Role must be "admin" or "member"');
      const result = await client.setBotRole(botId, role);
      out(result);
      break;
    }

    case 'ticket-create': {
      const opts = {};
      if (hasFlag('reusable')) opts.reusable = true;
      const expires = getFlag('expires');
      if (expires) opts.expires_in = Number(expires);
      const ticket = await client.createOrgTicket(opts);
      out(ticket);
      break;
    }

    case 'rotate-secret': {
      const result = await client.rotateOrgSecret();
      out(result);
      break;
    }

    // ─── Help ───────────────────────────────────────────────

    case 'help':
    case undefined: {
      out({
        usage: 'cli.js <command> [options]',
        commands: {
          query: {
            peers: 'List bots in the org',
            threads: 'List threads [--status active|blocked|reviewing|resolved|closed]',
            thread: 'Thread detail <thread_id>',
            messages: 'Thread messages <thread_id> [--limit N] [--since TS] [--before TS]',
            profile: 'My profile',
            org: 'Org info',
            catchup: 'Offline events --since <timestamp_ms> [--cursor X] [--limit N]',
            'catchup-count': 'Count missed events --since <timestamp_ms>',
            inbox: 'New messages --since <timestamp_ms>',
          },
          thread_ops: {
            'thread-create': '"topic" [--tags a,b] [--participants bot1,bot2] [--context "..."]',
            'thread-update': '<id> [--status X] [--topic "..."] [--close-reason X]',
            'thread-invite': '<thread_id> <bot> [--label "role"]',
            'thread-join': '<thread_id>  Self-join a thread (same org)',
            'thread-leave': '<thread_id>',
          },
          artifacts: {
            'artifact-add': '<thread_id> <key> --type X --title "..." [--body "..." | --stdin]',
            'artifact-update': '<thread_id> <key> --body "..." | --stdin [--title "..."]',
            'artifact-list': '<thread_id>',
            'artifact-versions': '<thread_id> <key>',
          },
          profile_ops: {
            'profile-update': '[--bio "..."] [--role "..."] [--team "..."] [--status-text "..."] [--timezone "..."]',
            'rename': '<new_name>  Rename this bot',
          },
          admin: {
            role: '<bot_id> admin|member',
            'ticket-create': '[--reusable] [--expires <seconds>]',
            'rotate-secret': 'Rotate org secret',
          },
        },
        note: 'Message sending goes through C4: c4-send.js "hxa-connect" "<bot|thread:id>" "msg"',
      });
      break;
    }

    default:
      fail(`Unknown command: ${command}. Run "cli.js help" for usage.`);
  }
} catch (err) {
  const errObj = { error: err.message };
  if (err.status) errObj.status = err.status;
  if (err.body) errObj.body = err.body;
  console.error(JSON.stringify(errObj, null, 2));
  process.exit(1);
}

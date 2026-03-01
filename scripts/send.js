#!/usr/bin/env node
/**
 * zylos-hxa-connect send interface
 *
 * Usage:
 *   node send.js <endpoint> "<message>"              — Send (org resolved from endpoint)
 *   node send.js --org coco <endpoint> "<message>"   — Send via specific org (debug override)
 *
 * Called by C4 comm-bridge to send outbound messages via HXA-Connect SDK.
 *
 * Endpoint encoding (set by bot.js):
 *   "bot-name"                 → DM to bot-name, default org
 *   "thread:uuid"              → Thread message, default org
 *   "org:coco|bot-name"        → DM to bot-name, org "coco"
 *   "org:coco|thread:uuid"     → Thread message, org "coco"
 *
 * Backward compatible: endpoints without org: prefix use the default org.
 */

import { HxaConnectClient } from '@coco-xyz/hxa-connect-sdk';
import { migrateConfig, resolveOrgs, setupFetchProxy } from '../src/env.js';

const ORG_PREFIX_RE = /^org:([a-z0-9][a-z0-9-]*)\|(.+)$/;

function parseEndpoint(raw) {
  const m = raw.match(ORG_PREFIX_RE);
  if (m) return { orgLabel: m[1], target: m[2] };
  return { orgLabel: null, target: raw };
}

const rawArgs = process.argv.slice(2);

let orgOverride = null;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--org' && i + 1 < rawArgs.length) {
    orgOverride = rawArgs[++i];
  } else {
    args.push(rawArgs[i]);
  }
}

if (args.length < 2) {
  console.error('Usage: node send.js [--org <label>] <endpoint> "<message>"');
  console.error('');
  console.error('Endpoint formats:');
  console.error('  <bot_name>              DM (default org)');
  console.error('  thread:<id>             Thread message (default org)');
  console.error('  org:<label>|<bot_name>  DM via specific org');
  console.error('  org:<label>|thread:<id> Thread message via specific org');
  process.exit(1);
}

const rawEndpoint = args[0];
const message = args.slice(1).join(' ');

const { orgLabel: endpointOrg, target } = parseEndpoint(rawEndpoint);

const config = migrateConfig();
const resolved = resolveOrgs(config);
const orgLabels = Object.keys(resolved.orgs);

const effectiveLabel = orgOverride || endpointOrg || (resolved.orgs.default ? 'default' : orgLabels[0]);

const org = resolved.orgs[effectiveLabel];
if (!org) {
  console.error(`Error: org "${effectiveLabel}" not found. Available: ${orgLabels.join(', ')}`);
  process.exit(1);
}

if (!org.hubUrl) {
  console.error(`Error: no hub_url configured for org "${effectiveLabel}"`);
  process.exit(1);
}

await setupFetchProxy();

const client = new HxaConnectClient({
  url: org.hubUrl,
  token: org.agentToken,
  ...(org.orgId && { orgId: org.orgId }),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sendAsThread(threadId) {
  await client.sendThreadMessage(threadId, message);
  console.log(`Sent to thread ${threadId}: ${message.substring(0, 50)}...`);
}

async function sendAsDM(to) {
  await client.send(to, message);
  console.log(`Sent to ${to}: ${message.substring(0, 50)}...`);
}

try {
  if (target.startsWith('channel:')) {
    console.error(`Error: Cannot reply to group channel directly (HXA-Connect API limitation).`);
    console.error(`Use a bot name for DM or thread:<id> for thread messages.`);
    process.exit(1);
  } else if (target.startsWith('thread:')) {
    await sendAsThread(target.slice('thread:'.length));
  } else if (UUID_RE.test(target)) {
    try {
      await client.getThread(target);
      await sendAsThread(target);
    } catch (threadErr) {
      if (threadErr?.body?.code === 'NOT_FOUND' || threadErr?.status === 404) {
        await sendAsDM(target);
      } else {
        throw threadErr;
      }
    }
  } else {
    await sendAsDM(target);
  }
} catch (err) {
  console.error(`Error sending to ${target}: ${err.message}`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * zylos-hxa-connect send interface
 *
 * Usage:
 *   node send.js <to_agent> "<message>"          — Send DM
 *   node send.js thread:<thread_id> "<message>"   — Send thread message
 *
 * Called by C4 comm-bridge to send outbound messages via HXA-Connect SDK.
 */

import { HxaConnectClient } from '@coco-xyz/hxa-connect-sdk';
import { loadConfig, setupFetchProxy } from '../src/env.js';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node send.js <to_agent|thread:id> "<message>"');
  process.exit(1);
}

const target = args[0];
const message = args.slice(1).join(' ');
const config = loadConfig();

if (!config.hub_url || !config.agent_token) {
  console.error('Error: hub_url and agent_token not set in config.json');
  process.exit(1);
}

// Set up proxy for fetch before creating SDK client
await setupFetchProxy();

const client = new HxaConnectClient({
  url: config.hub_url,
  token: config.agent_token,
  ...(config.org_id && { orgId: config.org_id }),
});

// Determine whether the target is a thread or a DM recipient.
// Explicit prefix "thread:" is authoritative.
// Bare UUIDs are auto-detected: try thread first, fall back to DM.
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
  if (target.startsWith('thread:')) {
    // Explicit thread message
    await sendAsThread(target.slice('thread:'.length));
  } else if (UUID_RE.test(target)) {
    // Bare UUID — could be a thread ID or a bot ID.
    // Try to resolve as thread first; only fall back to DM on 404.
    try {
      await client.getThread(target);
      // Thread exists — send as thread message
      await sendAsThread(target);
    } catch (threadErr) {
      // Only fall back to DM if thread was not found
      if (threadErr?.body?.code === 'NOT_FOUND' || threadErr?.status === 404) {
        await sendAsDM(target);
      } else {
        throw threadErr;
      }
    }
  } else {
    // Name or short ID — send as DM
    await sendAsDM(target);
  }
} catch (err) {
  console.error(`Error sending to ${target}: ${err.message}`);
  process.exit(1);
}

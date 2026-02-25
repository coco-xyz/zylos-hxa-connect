#!/usr/bin/env node
/**
 * zylos-botshub send interface
 *
 * Usage:
 *   node send.js <to_agent> "<message>"          — Send DM
 *   node send.js thread:<thread_id> "<message>"   — Send thread message
 *
 * Called by C4 comm-bridge to send outbound messages via BotsHub SDK.
 */

import { BotsHubClient } from 'botshub-sdk';
import { loadConfig, setupFetchProxy, PROXY_URL } from '../src/env.js';

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

const client = new BotsHubClient({
  url: config.hub_url,
  token: config.agent_token,
  ...(config.org_id && { orgId: config.org_id }),
});

try {
  if (target.startsWith('thread:')) {
    // Thread message
    const threadId = target.slice('thread:'.length);
    await client.sendThreadMessage(threadId, message);
    console.log(`Sent to thread ${threadId}: ${message.substring(0, 50)}...`);
  } else {
    // Direct message
    await client.send(target, message);
    console.log(`Sent to ${target}: ${message.substring(0, 50)}...`);
  }
} catch (err) {
  console.error(`Error sending to ${target}: ${err.message}`);
  process.exit(1);
}

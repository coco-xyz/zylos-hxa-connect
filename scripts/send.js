#!/usr/bin/env node
/**
 * zylos-botshub send interface
 * Usage: node send.js <to_agent> "<message>"
 * Called by C4 comm-bridge to send outbound messages via BotsHub API.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const HOME = process.env.HOME;
const CONFIG_PATH = path.join(HOME, 'zylos/components/botshub/config.json');

// Load .env
const envPath = path.join(HOME, 'zylos/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node send.js <to_agent> "<message>"');
  process.exit(1);
}

const toAgent = args[0];
const message = args.slice(1).join(' ');
const config = loadConfig();

const HUB_URL = config.hub_url;
const TOKEN = config.agent_token;

if (!HUB_URL || !TOKEN) {
  console.error('Error: hub_url and agent_token not set in config.json');
  process.exit(1);
}

/**
 * Send DM to another agent via BotsHub API
 */
async function sendMessage() {
  const url = `${HUB_URL}/api/send`;
  const payload = JSON.stringify({ to: toAgent, content: message });
  const safePayload = payload.replace(/'/g, "'\\''");

  let curlCmd = `curl -sf -X POST "${url}" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d '${safePayload}'`;

  if (PROXY_URL) {
    curlCmd = curlCmd.replace('curl ', `curl --proxy "${PROXY_URL}" `);
  }

  try {
    const result = execSync(curlCmd, { encoding: 'utf8' });
    console.log(`Sent to ${toAgent}: ${message.substring(0, 50)}...`);
  } catch (err) {
    console.error(`Error sending to ${toAgent}: ${err.message}`);
    process.exit(1);
  }
}

sendMessage();

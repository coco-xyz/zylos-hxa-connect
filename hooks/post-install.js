#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/botshub');

const DEFAULT_CONFIG = {
  hub_url: '',
  agent_id: '',
  agent_token: '',
  agent_name: '',
  display_name: ''
};

// 1. Create data subdirectories
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
console.log('[post-install] Created data directories');

// 2. Create default config if not exists
const configPath = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  console.log('[post-install] Created default config.json — fill in hub_url, agent_token, and agent_name');
} else {
  console.log('[post-install] config.json already exists, skipping');
}

console.log('[post-install] Complete!');

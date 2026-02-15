#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const configPath = path.join(process.env.HOME, 'zylos/components/botshub/config.json');

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let migrated = false;

  // Migration: ensure display_name field exists
  if (config.display_name === undefined) {
    config.display_name = config.agent_name || '';
    migrated = true;
  }

  if (migrated) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[post-upgrade] Config migrated');
  }
}

console.log('[post-upgrade] Complete!');

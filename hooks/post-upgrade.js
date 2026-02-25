#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const configPath = path.join(process.env.HOME, 'zylos/components/botshub/config.json');

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let migrated = false;

  // Migration: remove deprecated display_name field
  if (config.display_name !== undefined) {
    delete config.display_name;
    migrated = true;
  }

  if (migrated) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('[post-upgrade] Config migrated (removed display_name)');
  }
}

console.log('[post-upgrade] Complete!');

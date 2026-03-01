/**
 * Config loader/saver for zylos-hxa-connect.
 * Used by admin CLI and auth module.
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const CONFIG_PATH = path.join(HOME, 'zylos/components/hxa-connect/config.json');

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[hxa-connect] Failed to load config:', err.message);
    process.exit(1);
  }
}

export function saveConfig(config) {
  try {
    const tmpPath = CONFIG_PATH + `.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpPath, CONFIG_PATH);
    return true;
  } catch (err) {
    console.error('[hxa-connect] Failed to save config:', err.message);
    return false;
  }
}

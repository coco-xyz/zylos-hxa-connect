#!/usr/bin/env node
/**
 * Pre-upgrade hook for zylos-hxa-connect
 *
 * Called by Claude BEFORE CLI upgrade steps.
 * If this hook fails (exit code 1), the upgrade is aborted.
 *
 * Exit codes:
 *   0 - Continue with upgrade
 *   1 - Abort upgrade (with error message)
 */

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/hxa-connect');
const configPath = path.join(DATA_DIR, 'config.json');

console.log('[pre-upgrade] Running hxa-connect pre-upgrade checks...\n');

// 1. Backup config before upgrade
if (fs.existsSync(configPath)) {
  const backupPath = configPath + '.pre-upgrade.bak';
  fs.copyFileSync(configPath, backupPath);
  console.log(`[pre-upgrade] Config backed up to: ${backupPath}`);

  // 2. Validate config is parseable
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const isNewFormat = !!config.orgs;
    const isOldFormat = !!config.org_id;
    if (!isNewFormat && !isOldFormat) {
      console.error('[pre-upgrade] Warning: config.json has neither orgs nor org_id — may need manual fix');
    } else {
      console.log(`[pre-upgrade] Config format: ${isNewFormat ? 'multi-org' : 'single-org (will auto-migrate)'}`);
    }
  } catch (err) {
    console.error(`[pre-upgrade] Warning: config.json is not valid JSON: ${err.message}`);
    console.error('[pre-upgrade] The backup has been saved. Proceeding — post-upgrade may fail.');
  }
}

console.log('\n[pre-upgrade] Checks passed, proceeding with upgrade.');

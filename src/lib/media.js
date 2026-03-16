/**
 * Shared media download utilities — used by both bot.js (runtime) and cli.js (CLI).
 */

import path from 'path';

const HOME = process.env.HOME;

export const MEDIA_BASE_DIR = path.join(HOME, 'zylos/media/hxa-connect');

export const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
};

/**
 * Generate a local filename for a downloaded file.
 * @param {string} fileId - Hub file ID (opaque)
 * @param {string} contentType - MIME type from response
 * @returns {string} filename like "2026-03-14T12-00-00-000Z-abc123.png"
 */
export function generateFilename(fileId, contentType) {
  const ext = MIME_TO_EXT[contentType] || '';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 16);
  return `${timestamp}-${safeId}${ext}`;
}

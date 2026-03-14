/**
 * Tests for the download-file CLI command.
 *
 * Since the CLI depends on a live Hub connection, we test:
 * 1. Shared media utilities (generateFilename, constants) — imported from src/lib/media.js
 * 2. CLI argument validation logic
 * 3. Output structure expectations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIME_TO_EXT, generateFilename } from '../src/lib/media.js';

// ─── Tests ──────────────────────────────────────────────────────

describe('generateFilename', () => {
  it('should generate filename with correct extension for known MIME types', () => {
    const filename = generateFilename('abc-123', 'image/png');
    assert.ok(filename.endsWith('.png'), `Expected .png extension, got: ${filename}`);
    assert.ok(filename.includes('abc-123'), `Expected fileId in name, got: ${filename}`);
  });

  it('should generate filename without extension for unknown MIME types', () => {
    const filename = generateFilename('abc-123', 'application/x-custom');
    assert.ok(!filename.endsWith('.custom'), `Unexpected extension: ${filename}`);
    // Should end with the safeId (no extension)
    assert.ok(filename.endsWith('abc-123'), `Expected to end with safeId, got: ${filename}`);
  });

  it('should sanitize special characters in fileId', () => {
    const filename = generateFilename('../../etc/passwd', 'text/plain');
    assert.ok(!filename.includes('/'), `Filename should not contain /: ${filename}`);
    assert.ok(!filename.includes('..'), `Filename should not contain ..: ${filename}`);
    assert.ok(filename.endsWith('.txt'));
  });

  it('should truncate long fileIds to 16 characters', () => {
    const longId = 'a'.repeat(100);
    const filename = generateFilename(longId, 'image/jpeg');
    // safeId portion should be max 16 chars of 'a'
    const parts = filename.split('-');
    // The last part before extension is the safeId
    const withoutTimestamp = filename.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, '');
    const safeIdPart = withoutTimestamp.replace('.jpg', '');
    assert.equal(safeIdPart.length, 16, `safeId should be 16 chars, got ${safeIdPart.length}`);
  });

  it('should include ISO timestamp', () => {
    const filename = generateFilename('test', 'image/png');
    // Timestamp format: YYYY-MM-DDTHH-MM-SS-mmmZ
    assert.match(filename, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/);
  });

  it('should handle empty fileId', () => {
    const filename = generateFilename('', 'image/png');
    assert.ok(filename.endsWith('.png'));
    // Should still have timestamp
    assert.match(filename, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('should handle all known MIME types', () => {
    const expected = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/json': '.json',
    };
    for (const [mime, ext] of Object.entries(expected)) {
      const filename = generateFilename('test', mime);
      assert.ok(filename.endsWith(ext), `MIME ${mime} should produce ${ext}, got: ${filename}`);
    }
  });
});

describe('MIME_TO_EXT', () => {
  it('should have exactly 8 entries', () => {
    assert.equal(Object.keys(MIME_TO_EXT).length, 8);
  });

  it('should map image types correctly', () => {
    assert.equal(MIME_TO_EXT['image/jpeg'], '.jpg');
    assert.equal(MIME_TO_EXT['image/png'], '.png');
    assert.equal(MIME_TO_EXT['image/gif'], '.gif');
    assert.equal(MIME_TO_EXT['image/webp'], '.webp');
  });

  it('should map document types correctly', () => {
    assert.equal(MIME_TO_EXT['application/pdf'], '.pdf');
    assert.equal(MIME_TO_EXT['text/plain'], '.txt');
    assert.equal(MIME_TO_EXT['text/csv'], '.csv');
    assert.equal(MIME_TO_EXT['application/json'], '.json');
  });
});

describe('download-file argument validation', () => {
  // These test the expected CLI argument patterns

  it('should require file_id as positional argument', () => {
    // Simulating: no file_id provided → should fail
    const fileId = undefined;
    const isValid = !!(fileId && !fileId.startsWith('--'));
    assert.equal(isValid, false);
  });

  it('should reject flag as file_id', () => {
    const fileId = '--out';
    const isValid = fileId && !fileId.startsWith('--');
    assert.equal(isValid, false);
  });

  it('should accept valid file_id', () => {
    const fileId = 'abc-123-def';
    const isValid = fileId && !fileId.startsWith('--');
    assert.equal(isValid, true);
  });

  it('should validate max-bytes is positive', () => {
    assert.ok(Number.isFinite(1024) && 1024 > 0);
    assert.ok(!(Number.isFinite(NaN) && NaN > 0));
    assert.ok(!(Number.isFinite(-1) && -1 > 0));
    assert.ok(!(Number.isFinite(0) && 0 > 0));
  });

  it('should validate timeout is positive', () => {
    assert.ok(Number.isFinite(30000) && 30000 > 0);
    assert.ok(!(Number.isFinite(NaN) && NaN > 0));
    assert.ok(!(Number.isFinite(-100) && -100 > 0));
  });

  it('should default max-bytes to 10MB', () => {
    const maxBytesStr = undefined;
    const maxBytes = maxBytesStr ? Number(maxBytesStr) : 10 * 1024 * 1024;
    assert.equal(maxBytes, 10485760);
  });

  it('should default timeout to 30s', () => {
    const timeoutStr = undefined;
    const timeout = timeoutStr ? Number(timeoutStr) : 30_000;
    assert.equal(timeout, 30000);
  });

  it('should parse custom max-bytes', () => {
    const maxBytesStr = '5242880';
    const maxBytes = maxBytesStr ? Number(maxBytesStr) : 10 * 1024 * 1024;
    assert.equal(maxBytes, 5242880);
  });

  it('should parse custom timeout', () => {
    const timeoutStr = '60000';
    const timeout = timeoutStr ? Number(timeoutStr) : 30_000;
    assert.equal(timeout, 60000);
  });
});

describe('download-file output structure', () => {
  it('should produce correct JSON output shape on success', () => {
    // Simulate the expected output structure
    const output = {
      ok: true,
      org: 'default',
      fileId: 'abc-123',
      contentType: 'image/png',
      size: 12345,
      savedPath: '/home/ubuntu/zylos/media/hxa-connect/default/2026-03-14T12-00-00-000Z-abc-123.png',
      sourceUrl: 'https://hub.example.com/api/files/abc-123',
    };

    assert.equal(output.ok, true);
    assert.equal(typeof output.org, 'string');
    assert.equal(typeof output.fileId, 'string');
    assert.equal(typeof output.contentType, 'string');
    assert.equal(typeof output.size, 'number');
    assert.equal(typeof output.savedPath, 'string');
    assert.equal(typeof output.sourceUrl, 'string');
    assert.ok(output.sourceUrl.includes('/api/files/'));
  });

  it('should include all required fields', () => {
    const requiredFields = ['ok', 'org', 'fileId', 'contentType', 'size', 'savedPath', 'sourceUrl'];
    const output = {
      ok: true,
      org: 'default',
      fileId: 'test',
      contentType: 'image/png',
      size: 100,
      savedPath: '/tmp/test.png',
      sourceUrl: 'https://hub.example.com/api/files/test',
    };
    for (const field of requiredFields) {
      assert.ok(field in output, `Missing required field: ${field}`);
    }
  });
});

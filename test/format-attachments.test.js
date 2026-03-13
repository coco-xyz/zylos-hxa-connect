/**
 * Tests for formatAttachments(), extractText(), and related utility functions.
 *
 * These functions are module-scoped in bot.js, so we re-implement the same
 * logic here for unit testing. The integration-level behaviour is verified
 * by checking the formatted C4 output matches expectations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Re-implement the pure functions from bot.js for testing ────────────

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '?B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

const MAX_ATTACHMENT_PARTS = 20;

function formatAttachments(parts) {
  if (!parts || !parts.length) return '';
  const refs = [];
  let truncated = 0;
  for (const part of parts) {
    if (refs.length >= MAX_ATTACHMENT_PARTS) { truncated++; continue; }
    switch (part.type) {
      case 'image':
        refs.push(part.alt
          ? `[image: ${part.alt} — ${part.url}]`
          : `[image: ${part.url}]`);
        break;
      case 'file': {
        const size = part.size != null ? `, ${formatBytes(part.size)}` : '';
        refs.push(`[file: ${part.name} (${part.mime_type}${size}) — ${part.url}]`);
        break;
      }
      case 'link':
        refs.push(part.title
          ? `[link: ${part.title} — ${part.url}]`
          : `[link: ${part.url}]`);
        break;
      default:
        if (part.type && part.url) {
          refs.push(`[${part.type}: ${part.url}]`);
        }
        break;
    }
  }
  if (truncated > 0) refs.push(`[... and ${truncated} more]`);
  return refs.length > 0 ? '\n' + refs.join('\n') : '';
}

function extractText(msg) {
  const texts = [msg.content || ''];
  if (msg.parts) {
    for (const part of msg.parts) {
      if ('content' in part && typeof part.content === 'string') {
        texts.push(part.content);
      }
      if (part.type === 'image' && part.alt) texts.push(part.alt);
      if (part.type === 'file' && part.name) texts.push(part.name);
      if (part.type === 'link' && part.title) texts.push(part.title);
    }
  }
  return texts.join(' ');
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes', () => {
    assert.equal(formatBytes(0), '0B');
    assert.equal(formatBytes(512), '512B');
    assert.equal(formatBytes(1023), '1023B');
  });

  it('formats kilobytes', () => {
    assert.equal(formatBytes(1024), '1.0KB');
    assert.equal(formatBytes(1536), '1.5KB');
    assert.equal(formatBytes(10240), '10.0KB');
  });

  it('formats megabytes', () => {
    assert.equal(formatBytes(1048576), '1.0MB');
    assert.equal(formatBytes(5242880), '5.0MB');
    assert.equal(formatBytes(1572864), '1.5MB');
  });

  it('returns ?B for non-numeric input', () => {
    assert.equal(formatBytes('abc'), '?B');
    assert.equal(formatBytes(null), '?B');
    assert.equal(formatBytes(undefined), '?B');
  });

  it('returns ?B for NaN', () => {
    assert.equal(formatBytes(NaN), '?B');
  });

  it('returns ?B for negative values', () => {
    assert.equal(formatBytes(-1), '?B');
    assert.equal(formatBytes(-1024), '?B');
  });
});

describe('formatAttachments', () => {
  it('returns empty string for null/undefined parts', () => {
    assert.equal(formatAttachments(null), '');
    assert.equal(formatAttachments(undefined), '');
    assert.equal(formatAttachments([]), '');
  });

  it('skips text parts (already in msg.content)', () => {
    const parts = [{ type: 'text', content: 'hello' }];
    assert.equal(formatAttachments(parts), '');
  });

  it('skips markdown parts', () => {
    const parts = [{ type: 'markdown', content: '# heading' }];
    assert.equal(formatAttachments(parts), '');
  });

  it('skips json parts', () => {
    const parts = [{ type: 'json', content: { key: 'value' } }];
    assert.equal(formatAttachments(parts), '');
  });

  it('formats image with URL only', () => {
    const parts = [{ type: 'image', url: 'https://cdn.example.com/photo.jpg' }];
    assert.equal(formatAttachments(parts), '\n[image: https://cdn.example.com/photo.jpg]');
  });

  it('formats image with alt text', () => {
    const parts = [{
      type: 'image',
      url: 'https://cdn.example.com/photo.jpg',
      alt: 'A sunset over mountains'
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[image: A sunset over mountains — https://cdn.example.com/photo.jpg]'
    );
  });

  it('formats file without size', () => {
    const parts = [{
      type: 'file',
      url: 'https://cdn.example.com/report.pdf',
      name: 'report.pdf',
      mime_type: 'application/pdf'
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[file: report.pdf (application/pdf) — https://cdn.example.com/report.pdf]'
    );
  });

  it('formats file with size', () => {
    const parts = [{
      type: 'file',
      url: 'https://cdn.example.com/data.csv',
      name: 'data.csv',
      mime_type: 'text/csv',
      size: 2048
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[file: data.csv (text/csv, 2.0KB) — https://cdn.example.com/data.csv]'
    );
  });

  it('formats file with zero size', () => {
    const parts = [{
      type: 'file',
      url: 'https://cdn.example.com/empty.txt',
      name: 'empty.txt',
      mime_type: 'text/plain',
      size: 0
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[file: empty.txt (text/plain, 0B) — https://cdn.example.com/empty.txt]'
    );
  });

  it('formats link with title', () => {
    const parts = [{
      type: 'link',
      url: 'https://example.com/article',
      title: 'Example Article'
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[link: Example Article — https://example.com/article]'
    );
  });

  it('formats link without title', () => {
    const parts = [{
      type: 'link',
      url: 'https://example.com/page'
    }];
    assert.equal(
      formatAttachments(parts),
      '\n[link: https://example.com/page]'
    );
  });

  it('formats multiple mixed parts', () => {
    const parts = [
      { type: 'text', content: 'ignored text' },
      { type: 'image', url: 'https://cdn.example.com/1.png', alt: 'screenshot' },
      { type: 'file', url: 'https://cdn.example.com/log.txt', name: 'log.txt', mime_type: 'text/plain', size: 512 },
      { type: 'link', url: 'https://docs.example.com', title: 'API Docs' },
    ];
    const expected = [
      '',
      '[image: screenshot — https://cdn.example.com/1.png]',
      '[file: log.txt (text/plain, 512B) — https://cdn.example.com/log.txt]',
      '[link: API Docs — https://docs.example.com]',
    ].join('\n');
    assert.equal(formatAttachments(parts), expected);
  });

  it('handles multiple images', () => {
    const parts = [
      { type: 'image', url: 'https://cdn.example.com/a.png' },
      { type: 'image', url: 'https://cdn.example.com/b.png', alt: 'second' },
    ];
    const expected = [
      '',
      '[image: https://cdn.example.com/a.png]',
      '[image: second — https://cdn.example.com/b.png]',
    ].join('\n');
    assert.equal(formatAttachments(parts), expected);
  });

  it('surfaces unknown part types with url (forward-compat)', () => {
    const parts = [{ type: 'audio', url: 'https://cdn.example.com/clip.mp3' }];
    assert.equal(formatAttachments(parts), '\n[audio: https://cdn.example.com/clip.mp3]');
  });

  it('skips unknown part types without url', () => {
    const parts = [{ type: 'custom', data: 'something' }];
    assert.equal(formatAttachments(parts), '');
  });

  it('truncates when exceeding MAX_ATTACHMENT_PARTS', () => {
    const parts = Array.from({ length: 25 }, (_, i) => ({
      type: 'image', url: `https://cdn.example.com/${i}.png`
    }));
    const result = formatAttachments(parts);
    // Should have 20 image refs + 1 truncation notice
    const lines = result.split('\n').filter(Boolean);
    assert.equal(lines.length, 21);
    assert.ok(lines[20].includes('[... and 5 more]'));
  });

  it('counts only non-text parts toward truncation limit', () => {
    // text/markdown/json parts don't produce refs, so don't count toward limit
    const parts = [
      { type: 'text', content: 'hello' },
      { type: 'markdown', content: '# hi' },
      ...Array.from({ length: 20 }, (_, i) => ({
        type: 'image', url: `https://cdn.example.com/${i}.png`
      })),
      { type: 'image', url: 'https://cdn.example.com/overflow.png' },
    ];
    const result = formatAttachments(parts);
    assert.ok(result.includes('[... and 1 more]'));
  });
});

describe('extractText', () => {
  it('extracts msg.content', () => {
    assert.equal(extractText({ content: 'hello' }), 'hello');
  });

  it('returns empty string for missing content', () => {
    assert.equal(extractText({}), '');
  });

  it('extracts text part content', () => {
    const msg = {
      content: 'main',
      parts: [{ type: 'text', content: 'extra' }]
    };
    assert.equal(extractText(msg), 'main extra');
  });

  it('extracts markdown part content', () => {
    const msg = {
      content: '',
      parts: [{ type: 'markdown', content: '# heading' }]
    };
    assert.equal(extractText(msg), ' # heading');
  });

  it('skips json part content (object, not string)', () => {
    const msg = {
      content: 'text',
      parts: [{ type: 'json', content: { key: 'value' } }]
    };
    assert.equal(extractText(msg), 'text');
  });

  it('includes image alt text', () => {
    const msg = {
      content: 'check this',
      parts: [{ type: 'image', url: 'https://img.jpg', alt: '@mybot review please' }]
    };
    assert.equal(extractText(msg), 'check this @mybot review please');
  });

  it('handles image without alt text', () => {
    const msg = {
      content: 'photo',
      parts: [{ type: 'image', url: 'https://img.jpg' }]
    };
    assert.equal(extractText(msg), 'photo');
  });

  it('includes file name', () => {
    const msg = {
      content: '',
      parts: [{ type: 'file', url: 'https://file.pdf', name: 'report-@mybot.pdf', mime_type: 'application/pdf' }]
    };
    assert.equal(extractText(msg), ' report-@mybot.pdf');
  });

  it('includes link title', () => {
    const msg = {
      content: '',
      parts: [{ type: 'link', url: 'https://example.com', title: 'cc @mybot' }]
    };
    assert.equal(extractText(msg), ' cc @mybot');
  });

  it('combines all part types for mention detection', () => {
    const msg = {
      content: 'hello',
      parts: [
        { type: 'text', content: 'world' },
        { type: 'image', url: 'https://img.jpg', alt: 'screenshot' },
        { type: 'file', url: 'https://f.pdf', name: 'doc.pdf', mime_type: 'application/pdf' },
        { type: 'link', url: 'https://l.com', title: 'link text' },
      ]
    };
    assert.equal(extractText(msg), 'hello world screenshot doc.pdf link text');
  });

  it('detects @mention in image alt text', () => {
    const mentionRe = /@mybot\b/i;
    const msg = {
      content: '',
      parts: [{ type: 'image', url: 'https://img.jpg', alt: 'Hey @mybot check this' }]
    };
    assert.ok(mentionRe.test(extractText(msg)));
  });

  it('does not false-positive on non-mention images', () => {
    const mentionRe = /@mybot\b/i;
    const msg = {
      content: '',
      parts: [{ type: 'image', url: 'https://img.jpg', alt: 'just a photo' }]
    };
    assert.ok(!mentionRe.test(extractText(msg)));
  });
});

describe('C4 message formatting (integration)', () => {
  it('DM with image: includes attachment in formatted message', () => {
    const content = 'Check this image';
    const parts = [{ type: 'image', url: 'https://cdn.example.com/photo.jpg', alt: 'team photo' }];
    const attachments = formatAttachments(parts);
    const formatted = `[HXA:coco DM] alice said: ${content}${attachments}`;

    assert.ok(formatted.includes('Check this image'));
    assert.ok(formatted.includes('[image: team photo — https://cdn.example.com/photo.jpg]'));
  });

  it('Thread message with image: XML-escaped in current-message', () => {
    const content = 'Review this <screenshot>';
    const parts = [{ type: 'image', url: 'https://cdn.example.com/ss.png', alt: 'UI & layout' }];
    const attachments = formatAttachments(parts);
    const xmlContent = `<current-message>\n${escapeXml(content)}${escapeXml(attachments)}\n</current-message>`;

    assert.ok(xmlContent.includes('Review this &lt;screenshot&gt;'));
    assert.ok(xmlContent.includes('[image: UI &amp; layout'));
    assert.ok(!xmlContent.includes('<screenshot>'));
  });

  it('Thread context messages include attachments', () => {
    const ctxMsg = {
      content: 'see attached',
      parts: [{ type: 'file', url: 'https://cdn.example.com/spec.pdf', name: 'spec.pdf', mime_type: 'application/pdf', size: 10240 }],
      sender_name: 'bob'
    };
    const ctxAtt = formatAttachments(ctxMsg.parts);
    const line = `[${escapeXml(ctxMsg.sender_name)}]: ${escapeXml(ctxMsg.content || '')}${escapeXml(ctxAtt)}`;

    assert.ok(line.includes('[bob]: see attached'));
    assert.ok(line.includes('[file: spec.pdf (application/pdf, 10.0KB)'));
  });

  it('Thread context with XML special chars in attachment fields', () => {
    const ctxMsg = {
      content: '',
      parts: [{ type: 'file', url: 'https://cdn.example.com/f.txt', name: '<script>.txt', mime_type: 'text/plain' }],
      sender_name: 'bob'
    };
    const ctxAtt = formatAttachments(ctxMsg.parts);
    const line = `[${escapeXml(ctxMsg.sender_name)}]: ${escapeXml(ctxMsg.content || '')}${escapeXml(ctxAtt)}`;

    assert.ok(line.includes('&lt;script&gt;.txt'));
    assert.ok(!line.includes('<script>'));
  });

  it('Message with only image parts (no text content)', () => {
    const content = '';
    const parts = [{ type: 'image', url: 'https://cdn.example.com/photo.jpg' }];
    const attachments = formatAttachments(parts);
    const formatted = `[HXA:coco DM] alice said: ${content}${attachments}`;

    assert.ok(formatted.includes('[image: https://cdn.example.com/photo.jpg]'));
    assert.equal(formatted, '[HXA:coco DM] alice said: \n[image: https://cdn.example.com/photo.jpg]');
  });

  it('Message with text + multiple attachments', () => {
    const content = '@bot please analyze';
    const parts = [
      { type: 'text', content: 'additional context' },
      { type: 'image', url: 'https://cdn.example.com/chart.png', alt: 'revenue chart' },
      { type: 'image', url: 'https://cdn.example.com/table.png' },
      { type: 'file', url: 'https://cdn.example.com/data.xlsx', name: 'data.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 524288 },
    ];
    const attachments = formatAttachments(parts);
    const formatted = `[HXA:coco DM] alice said: ${content}${attachments}`;

    assert.ok(formatted.includes('@bot please analyze'));
    assert.ok(formatted.includes('[image: revenue chart — https://cdn.example.com/chart.png]'));
    assert.ok(formatted.includes('[image: https://cdn.example.com/table.png]'));
    assert.ok(formatted.includes('[file: data.xlsx'));
    assert.ok(formatted.includes('512.0KB'));
  });

  it('Content length check includes attachments', () => {
    const content = 'short';
    const parts = [{ type: 'image', url: 'https://cdn.example.com/photo.jpg' }];
    const attachments = formatAttachments(parts);
    const totalLength = content.length + attachments.length;

    assert.ok(totalLength > content.length, 'total should be larger than content alone');
    assert.ok(totalLength < 51200, 'should be within limit for this test case');
  });

  it('Oversized content + attachments would be rejected', () => {
    const MAX_CONTENT_LENGTH = 51200;
    const content = 'x'.repeat(51100);
    const parts = [
      { type: 'image', url: 'https://cdn.example.com/photo.jpg' },
      { type: 'file', url: 'https://cdn.example.com/doc.pdf', name: 'doc.pdf', mime_type: 'application/pdf' },
    ];
    const attachments = formatAttachments(parts);
    const totalLength = content.length + attachments.length;

    assert.ok(totalLength > MAX_CONTENT_LENGTH, 'should exceed limit');
  });

  it('Backward compat: messages without parts produce no attachments', () => {
    const content = 'plain text message';
    const attachments = formatAttachments(undefined);
    const formatted = `[HXA:coco DM] alice said: ${content}${attachments}`;

    assert.equal(formatted, '[HXA:coco DM] alice said: plain text message');
  });

  it('Reply-to context only includes content (ReplyToMessage has no parts)', () => {
    const reply = {
      id: 'msg-1',
      sender_id: 'bot-1',
      sender_name: 'alice',
      content: 'original message',
      created_at: Date.now()
    };
    const replySender = escapeXml(reply.sender_name);
    const replyContent = escapeXml(reply.content || '');
    const replyTag = `<replying-to>\n[${replySender}]: ${replyContent}\n</replying-to>`;

    assert.ok(replyTag.includes('[alice]: original message'));
    assert.ok(!replyTag.includes('undefined'));
  });
});

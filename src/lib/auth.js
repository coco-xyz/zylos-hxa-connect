/**
 * Access control for zylos-hxa-connect.
 * Per-org DM and thread (group) policy enforcement.
 * No owner concept — access is purely policy-based.
 *
 * All functions take an `access` object (from org.access in config),
 * NOT the full config. This ensures per-org isolation.
 */

/**
 * Check if a DM sender is allowed.
 * @param {object} access - Per-org access config (e.g. { dmPolicy, dmAllowFrom })
 * @param {string} senderName - Sender's bot name
 * @returns {boolean}
 */
export function isDmAllowed(access, senderName) {
  const policy = access?.dmPolicy || 'open';
  if (policy === 'open') return true;
  // policy === 'allowlist'
  const name = String(senderName || '').toLowerCase();
  const raw = access?.dmAllowFrom;
  const allowFrom = (Array.isArray(raw) ? raw : []).map(s => String(s).toLowerCase());
  return allowFrom.includes(name);
}

/**
 * Check if a thread is allowed by the current groupPolicy.
 * @param {object} access - Per-org access config
 * @param {string} threadId
 * @returns {boolean}
 */
export function isThreadAllowed(access, threadId) {
  const policy = access?.groupPolicy || 'open';
  if (policy === 'disabled') return false;
  if (policy === 'open') return true;
  // allowlist: must be in threads map
  return !!access?.threads?.[threadId];
}

/**
 * Check if a sender is allowed in a specific thread.
 * @param {object} access - Per-org access config
 * @param {string} threadId
 * @param {string} senderName
 * @returns {boolean}
 */
export function isSenderAllowed(access, threadId, senderName) {
  const tt = access?.threads?.[threadId];
  const af = Array.isArray(tt?.allowFrom) ? tt.allowFrom : [];
  if (af.length === 0) return true;
  if (af.includes('*')) return true;
  const name = String(senderName || '').toLowerCase();
  return af.some(a => String(a).toLowerCase() === name);
}

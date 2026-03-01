/**
 * Access control for zylos-hxa-connect.
 * Per-org DM and channel (group) policy enforcement.
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
 * Check if a channel (group) is allowed by the current policy.
 * @param {object} access - Per-org access config
 * @param {string} channelId
 * @returns {boolean}
 */
export function isChannelAllowed(access, channelId) {
  const policy = access?.groupPolicy || 'open';
  if (policy === 'disabled') return false;
  if (policy === 'open') return true;
  // allowlist: must be in channels map
  return !!access?.channels?.[channelId];
}

/**
 * Check if a sender is allowed in a specific channel.
 * @param {object} access - Per-org access config
 * @param {string} channelId
 * @param {string} senderName
 * @returns {boolean}
 */
export function isSenderAllowed(access, channelId, senderName) {
  const cc = access?.channels?.[channelId];
  const af = Array.isArray(cc?.allowFrom) ? cc.allowFrom : [];
  if (af.length === 0) return true;
  if (af.includes('*')) return true;
  const name = String(senderName || '').toLowerCase();
  return af.some(a => String(a).toLowerCase() === name);
}

/**
 * Access control for zylos-hxa-connect.
 * DM and channel (group) policy enforcement.
 * No owner concept — access is purely policy-based.
 */

/**
 * Check if a DM sender is allowed.
 * @param {object} config - Full config object
 * @param {string} senderName - Sender's bot name
 * @returns {boolean}
 */
export function isDmAllowed(config, senderName) {
  const policy = config.dmPolicy || 'open';
  if (policy === 'open') return true;
  // policy === 'allowlist'
  const allowFrom = (config.dmAllowFrom || []).map(s => s.toLowerCase());
  return allowFrom.includes((senderName || '').toLowerCase());
}

/**
 * Check if a channel (group) is allowed by the current policy.
 * @param {object} config
 * @param {string} channelId
 * @returns {boolean}
 */
export function isChannelAllowed(config, channelId) {
  const policy = config.groupPolicy || 'open';
  if (policy === 'disabled') return false;
  if (policy === 'open') return true;
  // allowlist: must be in channels map
  return !!config.channels?.[channelId];
}

/**
 * Check if a sender is allowed in a specific channel.
 * @param {object} config
 * @param {string} channelId
 * @param {string} senderName
 * @returns {boolean}
 */
export function isSenderAllowed(config, channelId, senderName) {
  const cc = config.channels?.[channelId];
  if (!cc?.allowFrom || cc.allowFrom.length === 0) return true;
  if (cc.allowFrom.includes('*')) return true;
  return cc.allowFrom.some(a => a.toLowerCase() === (senderName || '').toLowerCase());
}

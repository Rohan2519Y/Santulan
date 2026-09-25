/*
 * Santulan ID (BUILD 03 §5): server-generated, opaque, never reused, never sequential, encodes no personal
 * characteristic. Format: "STN-" + 20 uppercase Crockford Base32 characters (100 random bits).
 * The database UNIQUE constraint is the collision authority; callers retry on the improbable collision.
 */
const { randomBytes } = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32: no I, L, O, U

function generateSantulanId() {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i += 1) out += ALPHABET[bytes[i] & 31];
  return `STN-${out}`;
}

const SANTULAN_ID_PATTERN = /^STN-[0-9A-HJKMNP-TV-Z]{20}$/;

module.exports = { generateSantulanId, SANTULAN_ID_PATTERN };

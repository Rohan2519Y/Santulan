/*
 * Controlled participant-facing messages (backend/config/messages.json). Wording is owner-approved content: this loader
 * only reads it, so copy can change without code changes. Missing keys fall back to a neutral generic sentence.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'config', 'messages.json');
const FALLBACK = 'This action is not available right now.';

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (err) { cache = {}; }
  return cache;
}

const message = (key) => (typeof load()[key] === 'string' ? load()[key] : FALLBACK);

module.exports = { message };

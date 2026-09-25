/*
 * Governed evidence states (BUILD 06 §8, audit B06-AUD-010). The canonical schema has no per-domain evidence registry, so the
 * state comes from governed server configuration at EVIDENCE_CONFIG_PATH: { "<assessment_version_id>": { "C1": "S2" } }.
 * Missing file, version or domain => S1 (research only) - participant interpretation is never promoted silently.
 * Only S1, S2 and SH are accepted from configuration. S3-S5 stay behind the database release gate
 * (app.allow_advanced_evidence_states) and are never enabled from a file; a file that asks for them fails closed.
 */
const fs = require('fs');
const config = require('../../config');

// The file can HOLD (SH), PIN to research-only (S1) or - with the advanced-evidence switch - assign S3-S5. It can NEVER promote a
// domain to S2 (only the audited pilot-S2 switch does) and S0 cannot be configured (feature 006, scoring master).
const ALLOWED = new Set(['S1', 'SH', 'S3', 'S4', 'S5']);
const DOMAINS = new Set(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
class EvidenceConfigError extends Error {}

let cache = { path: null, mtimeMs: -1, data: {} };

function load(path = config.evidenceConfigPath) {
  if (!path) return {};
  let stat;
  try { stat = fs.statSync(path); } catch (err) { return {}; }
  if (cache.path === path && cache.mtimeMs === stat.mtimeMs) return cache.data;
  let data;
  try { data = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (err) { throw new EvidenceConfigError('the evidence configuration is not valid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new EvidenceConfigError('the evidence configuration must be an object');
  cache = { path, mtimeMs: stat.mtimeMs, data };
  return data;
}

/** The domain -> state map for one assessment version ({} when nothing is configured). Throws on a disallowed value. */
function statesFor(assessmentVersionId, path) {
  const forVersion = load(path)[assessmentVersionId];
  if (forVersion === undefined) return {};
  if (!forVersion || typeof forVersion !== 'object' || Array.isArray(forVersion)) throw new EvidenceConfigError('the evidence configuration for a version must be an object');
  for (const [domain, state] of Object.entries(forVersion)) {
    if (!DOMAINS.has(domain)) throw new EvidenceConfigError(`unknown domain ${domain} in the evidence configuration`);
    if (!ALLOWED.has(state)) throw new EvidenceConfigError(`evidence state ${state} cannot be configured (only S1, S2 and SH)`);
  }
  return forVersion;
}

module.exports = { statesFor, EvidenceConfigError };

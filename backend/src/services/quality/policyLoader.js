/*
 * Quality policy (BUILD 06 §9-§11). The approved detector policy is governed configuration read from QUALITY_POLICY_PATH:
 *   { "version": "...", "detectors": { "Q09": { "approvedTriggerSources": ["..."] }, "Q01": { "enabled": true, ... } } }
 * No file (or an empty path) means the built-in policy "q06-only": only the deterministic Q06 version-mismatch stop runs.
 * A file that exists but cannot be parsed is a configuration error and fails closed (the quality run refuses to proceed).
 * The policy is re-read when the file changes, so an approval takes effect without a restart.
 */
const fs = require('fs');
const config = require('../../config');

const BUILT_IN = { version: 'q06-only', detectors: {} };
let cache = { path: null, mtimeMs: -1, policy: BUILT_IN };

class PolicyError extends Error {}

function loadPolicy(path = config.qualityPolicyPath) {
  if (!path) return BUILT_IN;
  let stat;
  try { stat = fs.statSync(path); } catch (err) { return BUILT_IN; }             // a missing file approves nothing extra
  if (cache.path === path && cache.mtimeMs === stat.mtimeMs) return cache.policy;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (err) { throw new PolicyError('the quality policy file is not valid JSON'); }
  if (!parsed || typeof parsed.version !== 'string' || !parsed.version.trim() || typeof parsed.detectors !== 'object' || parsed.detectors === null || Array.isArray(parsed.detectors)) {
    throw new PolicyError('the quality policy needs a version and a detectors object');
  }
  cache = { path, mtimeMs: stat.mtimeMs, policy: parsed };
  return parsed;
}

module.exports = { loadPolicy, PolicyError, BUILT_IN };

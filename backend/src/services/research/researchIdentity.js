/*
 * Research identity minimisation (BUILD 08 section 10; AT-30, B08-065). The research views expose only the opaque Santulan ID; this
 * module is the last line of defence and the extension point. The DEFAULT policy:
 *   - never lets a direct-identity column through (participant_id, auth provider fields, external student id, contact and guardian fields)
 *   - excludes a WITHDRAWN participant everywhere (the count reaches EXPORT_METADATA)
 *   - replaces santulan_id with participant_research_id (Student Demographic & Research Profile Capture Form v1.0's
 *     "Research identity rule": research datasets use a governed pseudonymous key, decoupled from the operational id
 *     used for sign-in/credential-reset, so a research-dataset exposure and an operational one are never the same event)
 * An approved pseudonymisation policy can later replace it through setPolicy() with the same interface - the exporter does not change.
 *
 *   policy = { name, version, includeRow(row) -> boolean, mapRow(row) -> row }
 */
const crypto = require('crypto');
const config = require('../../config');

const FORBIDDEN_COLUMNS = new Set([
  'participant_id', 'auth_provider', 'auth_provider_subject_id', 'external_student_id', 'email', 'mobile', 'phone', 'contact', 'contact_email', 'contact_mobile',
  'guardian_name', 'guardian_email', 'guardian_mobile', 'parent_name', 'parent_email', 'parent_mobile', 'full_name', 'name', 'date_of_birth', 'dob',
]);

/** Drops any forbidden column from a row (the views never emit them; this makes it impossible for a future view to). */
function stripDirectIdentity(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) if (!FORBIDDEN_COLUMNS.has(key)) out[key] = value;
  return out;
}

/**
 * A stable, deterministic, one-way pseudonym for a participant: PR-<6 digits>, derived by keyed hash so it can never be
 * recomputed without the server's own secret (reuses JWT_SECRET rather than adding a second required secret just for
 * this - the two uses are unrelated, so there is no cross-purpose weakness in sharing it). The same santulan_id always
 * yields the same participant_research_id, so joins across exports of the same participant stay possible without ever
 * carrying the operational id itself.
 */
function participantResearchId(santulanId) {
  const digest = crypto.createHmac('sha256', config.jwtSecret).update(`participant-research-id:${santulanId}`).digest('hex');
  const n = parseInt(digest.slice(0, 8), 16) % 1000000;
  return `PR-${String(n).padStart(6, '0')}`;
}

const defaultPolicy = {
  name: 'default-research-safe',
  version: '2',
  includeRow: (row) => row.participant_status !== 'WITHDRAWN',
  mapRow: (row) => {
    if (!('santulan_id' in row)) return row;
    const { santulan_id: santulanId, ...rest } = row;
    return { participant_research_id: participantResearchId(santulanId), ...rest };
  },
};

let current = defaultPolicy;

function isPolicy(p) {
  return !!p && typeof p.name === 'string' && typeof p.version === 'string' && typeof p.includeRow === 'function' && typeof p.mapRow === 'function';
}

/** Installs an approved policy (same interface). Returns the previous one. */
function setPolicy(policy) {
  if (!isPolicy(policy)) throw new Error('A research identity policy needs name, version, includeRow() and mapRow()');
  const previous = current;
  current = policy;
  return previous;
}

const getPolicy = () => current;
const resetPolicy = () => { current = defaultPolicy; };

/** Applies the policy to one row: null when the row is excluded, otherwise the projected row without direct-identity columns. */
function project(row, policy = current) {
  if (!policy.includeRow(row)) return null;
  return stripDirectIdentity(policy.mapRow(stripDirectIdentity(row)));
}

module.exports = { FORBIDDEN_COLUMNS, stripDirectIdentity, participantResearchId, defaultPolicy, setPolicy, getPolicy, resetPolicy, project, isPolicy };

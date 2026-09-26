/*
 * Admin rules (BUILD 08; feature 006 US5): the pilot role model, the control-plane states, institution / cohort / participant status
 * changes and the listing filter whitelist. The store enforces the same limits (validators, no remove); this is the application half.
 *
 *   - only an ACTIVE SUPER_ADMIN can operate the platform: INSTITUTION_ADMIN and RESEARCH_OPERATOR exist as roles but cannot be ACTIVE
 *   - the control plane has three states; PAUSED and STOPPED need a reason; only OPEN lets new attempts start
 *   - institutions and cohorts are never deleted - they are archived (status), and an ARCHIVED one never comes back
 *   - a participant is suspended or reactivated with a reason; WITHDRAWN is set by the consent workflow and is never undone here
 */
const { HttpError } = require('../../errors');

const ADMIN_ROLES = ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'RESEARCH_OPERATOR'];
const ACTIVE_ROLES = new Set(['SUPER_ADMIN']);
const CONTROL_STATES = ['OPEN', 'PAUSED', 'STOPPED'];
const INSTITUTION_TYPES = ['SCHOOL', 'COLLEGE', 'UNIVERSITY'];
const ENTITY_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];
const PARTICIPANT_LISTING_KEYS = ['route', 'institutionId', 'cohortId', 'status', 'search', 'limit'];
const REASON_MIN = 3;
const REASON_MAX = 300;
// A Santulan ID is STN- plus 20 characters of this alphabet (I, L, O and U are never used, so they cannot be misread).
const SANTULAN_ID_BODY = /^[0-9A-HJKMNP-TV-Z]{1,20}$/;

const unknownFilter = (keys) => new HttpError(422, 'EXPORT_FILTER_UNKNOWN', `Unknown filter: ${keys.join(', ')}`);
const invalid = (message) => new HttpError(422, 'INVALID_STATE', message);

/** A pilot role may only be ACTIVE for SUPER_ADMIN (G-07); the store validator says the same. */
function assertRoleCanBeActive(role, status) {
  if (!ADMIN_ROLES.includes(role)) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown administrator role');
  if (status === 'ACTIVE' && !ACTIVE_ROLES.has(role)) throw new HttpError(422, 'INVALID_STATE', `${role} cannot be ACTIVE in the pilot`);
}

/** The reason of a privileged change: 3 to 300 characters after trimming (required for pause, stop, suspend and switch changes). */
function cleanReason(reason, { required = true } = {}) {
  if (reason === undefined || reason === null || reason === '') {
    if (required) throw new HttpError(422, 'VALIDATION_ERROR', 'A reason is required');
    return null;
  }
  const text = String(reason).trim();
  if (text.length < REASON_MIN || text.length > REASON_MAX) throw new HttpError(422, 'VALIDATION_ERROR', `The reason must be ${REASON_MIN} to ${REASON_MAX} characters`);
  return text;
}

/** A control change: PAUSED and STOPPED need a reason, OPEN may carry one. */
function assertControlChange(state, reason) {
  if (!CONTROL_STATES.includes(state)) throw new HttpError(400, 'VALIDATION_ERROR', `state must be one of ${CONTROL_STATES.join(', ')}`);
  return cleanReason(reason, { required: state !== 'OPEN' });
}

/** Institution / cohort status moves: ACTIVE <-> INACTIVE, either -> ARCHIVED, ARCHIVED is final. */
function assertStatusMove(from, to) {
  if (!ENTITY_STATUSES.includes(to)) throw new HttpError(400, 'VALIDATION_ERROR', `status must be one of ${ENTITY_STATUSES.join(', ')}`);
  if (from === to) return;
  if (from === 'ARCHIVED') throw invalid('An archived record cannot be reopened');
}

/** Suspend / reactivate only; WITHDRAWN is final for this endpoint. */
function assertParticipantStatusMove(from, to) {
  if (!['ACTIVE', 'SUSPENDED'].includes(to)) throw new HttpError(400, 'VALIDATION_ERROR', 'status must be ACTIVE or SUSPENDED');
  if (from === 'WITHDRAWN') throw invalid('A withdrawn participant cannot be changed here');
  if (from === to) throw invalid(`The participant is already ${from}`);
}

/**
 * Turns an admin's Santulan ID search box into a safe prefix match.
 *
 * Only the characters a Santulan ID can legally hold are accepted, so nothing typed here ever reaches the regex engine
 * as a metacharacter - that rules out both regex injection and catastrophic backtracking, rather than escaping after
 * the fact. The match is anchored and upper-cased (ids are stored upper-case) so it uses `uq_participants_santulan_id`
 * instead of scanning; a case-insensitive regex would not. The `STN-` prefix is optional, so pasting either the whole
 * id or just its body works. Returns null for an empty box - "no search" is not an error.
 */
function santulanIdPrefix(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!text) return null;
  const body = text.startsWith('STN-') ? text.slice(4) : text;
  if (!SANTULAN_ID_BODY.test(body)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Search by Santulan ID: up to 20 characters of 0-9 and A-Z (never I, L, O or U), with or without the STN- prefix');
  }
  return { $regex: `^STN-${body}` };
}

/** Whitelist for the participant listing: an unknown key is a 422 (never silently ignored). */
function assertKnownListingKeys(query) {
  const unknown = Object.keys(query || {}).filter((k) => !PARTICIPANT_LISTING_KEYS.includes(k));
  if (unknown.length) throw unknownFilter(unknown);
}

/** A parent chain must not loop: walks up from `parentId` and refuses when it meets `id`. `lookup(id)` returns { parentId } or null. */
async function assertNoParentCycle(id, parentId, lookup) {
  const seen = new Set([id]);
  let current = parentId;
  while (current) {
    if (seen.has(current)) throw invalid('An institution cannot be its own ancestor');
    seen.add(current);
    const row = await lookup(current); // eslint-disable-line no-await-in-loop
    if (!row) throw new HttpError(422, 'SCOPE_INVALID', 'The parent institution does not exist');
    current = row.parentId;
  }
}

module.exports = {
  ADMIN_ROLES, CONTROL_STATES, INSTITUTION_TYPES, ENTITY_STATUSES, PARTICIPANT_LISTING_KEYS, REASON_MIN, REASON_MAX,
  assertRoleCanBeActive, cleanReason, assertControlChange, assertStatusMove, assertParticipantStatusMove, assertKnownListingKeys, assertNoParentCycle, unknownFilter, santulanIdPrefix,
};

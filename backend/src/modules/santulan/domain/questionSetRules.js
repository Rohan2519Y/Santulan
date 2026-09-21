/*
 * Question-set rules (spec FR-016..018, upload-format section 4; data-model section 7). The store holds the shape and the
 * two uniqueness guarantees (one live revision per label, one open set per age group); these rules decide what an upload does
 * and which lifecycle moves are legal, and are applied inside the same transaction as the write.
 */
const { HttpError } = require('../../../shared/errors');
const canonical = require('../questionsets/canonical');
const framework = require('../questionsets/framework');
const { GROUP } = require('../questionsets/questionSetValidator');

const AGE_RANGE = { ADOLESCENT: [13, 17], EMERGING_ADULT: [18, 25] };
const ageRange = (ageGroup) => AGE_RANGE[ageGroup];

/**
 * What an upload of `hash` under a label does, given that label's revisions (any order).
 * -> { action: 'CREATE'|'NOOP'|'REVISE'|'REFUSE', latest, nextRevision }
 */
function decideUpload(revisions, hash) {
  if (!revisions || !revisions.length) return { action: 'CREATE', latest: null, nextRevision: 1 };
  const latest = [...revisions].sort((a, b) => b.revision - a.revision)[0];
  if (latest.status !== 'DRAFT') return { action: 'REFUSE', latest, nextRevision: null };
  if (latest.content_hash === hash) return { action: 'NOOP', latest, nextRevision: null };
  return { action: 'REVISE', latest, nextRevision: latest.revision + 1 };
}

function assertUploadable(decision) {
  if (decision.action === 'REFUSE') {
    throw new HttpError(409, 'SET_NOT_DRAFT', 'A question set with this label is already frozen or retired; upload under a new assessment_version label');
  }
}

/** Questions eligible for scoring for this age group: CORE + ACTIVE, band and context fitting the group. */
function eligibleForGroup(item, ageGroup) {
  const g = GROUP[ageGroup];
  return item.layer === 'CORE' && item.status === 'ACTIVE' && g.bands.includes(item.age_band) && g.contexts.includes(item.context);
}

/** Domains C1..C7 that have no eligible question (freeze prerequisite). */
function missingDomains(items, ageGroup) {
  const have = new Set(items.filter((i) => eligibleForGroup(i, ageGroup)).map((i) => i.domain_code));
  return framework.DOMAIN_CODES.filter((d) => !have.has(d));
}

function verifyContentHash(set, items) {
  return canonical.contentHash(items) === set.content_hash;
}

function assertFreezable(set, items) {
  if (set.status !== 'DRAFT') throw new HttpError(409, 'SET_NOT_DRAFT', 'Only a draft question set can be frozen');
  const missing = missingDomains(items, set.configuration);
  if (missing.length) {
    throw new HttpError(409, 'SET_INCOMPLETE', `Every domain needs at least one eligible question; missing: ${missing.join(', ')}`, { missingDomains: missing });
  }
  if (!verifyContentHash(set, items)) throw new HttpError(503, 'CATALOG_DRIFT', 'The stored questions do not match the set fingerprint');
}

function assertOpenable(set) {
  if (set.status !== 'FROZEN') throw new HttpError(409, 'SET_NOT_FROZEN', 'Only a frozen question set can be opened for participation');
  if (set.participation_state === 'OPEN') throw new HttpError(409, 'OPEN_SET_EXISTS', 'This question set is already open');
}

function assertClosable(set) {
  if (set.status !== 'FROZEN') throw new HttpError(409, 'SET_NOT_FROZEN', 'Only a frozen question set can be closed');
  if (set.participation_state !== 'OPEN') throw new HttpError(409, 'SET_NOT_FROZEN', 'This question set is not open');
}

module.exports = { ageRange, decideUpload, assertUploadable, eligibleForGroup, missingDomains, verifyContentHash, assertFreezable, assertOpenable, assertClosable };

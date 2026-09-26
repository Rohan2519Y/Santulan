/*
 * Fingerprint verification for frozen question sets (constitution II; upload-format section 4). A frozen set's stored
 * content_hash must equal the hash recomputed from its questions and options. Checked when a set is opened, when an attempt
 * starts (assertIntact), at start-up for every OPEN set (verifyOpenSets) and by scripts/db-verify.js. A mismatch is a hard
 * stop for that set: attempts on it are refused (503 CATALOG_DRIFT) and the event is logged.
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const sets = require('../../models/repositories/questionSets');
const rules = require('../domain/questionSetRules');
const logger = require('../../utils/logger');

const quarantined = new Set();

/** Throws 503 CATALOG_DRIFT when the set's questions no longer match its fingerprint. `tx` is a store context. */
async function assertIntact(tx, set) {
  if (quarantined.has(set._id)) throw new HttpError(503, 'CATALOG_DRIFT', 'This question set is unavailable while it is being checked');
  const items = await sets.questionsOf(tx, set._id);
  if (!rules.verifyContentHash(set, items)) {
    quarantined.add(set._id);
    logger.error({ versionLabel: set.version_label, revision: set.revision, setId: set._id }, 'fingerprint mismatch: question set quarantined');
    throw new HttpError(503, 'CATALOG_DRIFT', 'This question set is unavailable while it is being checked');
  }
}

/** Verifies every OPEN set; mismatching sets are quarantined. Returns the labels that failed. */
async function verifyOpenSets() {
  return store.withScope(store.systemScope(), async (tx) => {
    const open = await tx.c.assessment_versions.find({ participation_state: 'OPEN', status: 'FROZEN' });
    const bad = [];
    for (const set of open) {
      try { await assertIntact(tx, set); } catch (e) { bad.push(`${set.version_label} r${set.revision}`); }
    }
    return bad;
  });
}

module.exports = { assertIntact, verifyOpenSets, isQuarantined: (id) => quarantined.has(id), clearQuarantine: () => quarantined.clear() };

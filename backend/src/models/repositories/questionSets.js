/*
 * Question sets and questions (assessment_versions, items). Items are Tier A: inserted with their set, never updated
 * (there is no update path for a question or its options). The set has only compare-and-set lifecycle moves.
 */
const { camel } = require('../db/naming');

const S = (d) => camel(d, 'setId');

async function findRevisions(tx, versionLabel) {
  return tx.c.assessment_versions.find({ version_label: versionLabel }, { sort: { revision: -1 } });
}

async function getSetRaw(tx, id) { return tx.c.assessment_versions.findOne({ _id: id }); }

async function questionsOf(tx, setId) {
  return tx.c.items.find({ assessment_version_id: setId }, { sort: { display_order: 1 } });
}

async function insertSetWithItems(tx, set, items) {
  await tx.c.assessment_versions.insertOne(set);
  if (items.length) await tx.c.items.insertMany(items);
  return set;
}

/** DRAFT -> RETIRED for a superseded draft revision (compare-and-set). */
async function retireDraft(tx, id) {
  return tx.c.assessment_versions.transition(id, { status: 'DRAFT' }, { status: 'RETIRED' });
}

async function freeze(tx, id, contentHash) {
  return tx.c.assessment_versions.transition(id, { status: 'DRAFT', content_hash: contentHash }, { status: 'FROZEN', frozen_at: new Date() });
}

async function open(tx, id) {
  return tx.c.assessment_versions.transition(id, { status: 'FROZEN', participation_state: 'CLOSED' }, { participation_state: 'OPEN' });
}

async function close(tx, id) {
  return tx.c.assessment_versions.transition(id, { status: 'FROZEN', participation_state: 'OPEN' }, { participation_state: 'CLOSED' });
}

/** Sets with question and option counts, newest first. Filters: ageGroup, status. */
async function listSets(tx, { ageGroup, status } = {}) {
  const filter = {};
  if (ageGroup) filter.configuration = ageGroup;
  if (status) filter.status = status;
  const sets = await tx.c.assessment_versions.find(filter, { sort: { created_at: -1, revision: -1 } });
  const counts = await tx.c.items.aggregate([
    { $match: { assessment_version_id: { $in: sets.map((s) => s._id) } } },
    { $group: { _id: '$assessment_version_id', questions: { $sum: 1 }, options: { $sum: { $size: '$options' } } } },
  ]);
  const by = new Map(counts.map((c) => [c._id, c]));
  return sets.map((s) => ({ ...s, question_count: (by.get(s._id) || {}).questions || 0, option_count: (by.get(s._id) || {}).options || 0 }));
}

/** A set document with its question and option counts. */
async function withCounts(tx, set) {
  const items = await questionsOf(tx, set._id);
  return { ...set, question_count: items.length, option_count: items.reduce((n, i) => n + i.options.length, 0) };
}

/** API shape of a set (camelCase, counts included). */
function toApi(s) {
  return {
    setId: s._id,
    versionLabel: s.version_label,
    revision: s.revision,
    ageGroup: s.configuration,
    status: s.status,
    participationState: s.participation_state,
    questionCount: s.question_count,
    optionCount: s.option_count,
    contentHash: s.content_hash,
    sourceFileHash: s.source_file_hash,
    frozenAt: s.frozen_at,
    createdAt: s.created_at,
  };
}

module.exports = { findRevisions, getSetRaw, questionsOf, insertSetWithItems, retireDraft, freeze, open, close, listSets, withCounts, toApi, S };

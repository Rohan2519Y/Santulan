/*
 * Question-set service (spec US2/US4). One transaction per action: validate -> decide -> write -> audit. A rejected upload
 * stores nothing except one audit row. The uploaded file bytes are never retained (only their SHA-256 in the audit trail).
 */
const { HttpError } = require('../../errors');
const store = require('../../models/db');
const sets = require('../../models/repositories/questionSets');
const responsesRepo = require('../../models/repositories/responses');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/questionSetRules');
const attemptRules = require('../domain/attemptRules');
const canonical = require('./canonical');
const { parseQuestionWorkbook } = require('./questionSetParser');
const { validate } = require('./questionSetValidator');

const SHOWN_PROBLEMS = 200;
// ASSUMED (no contract for this report): only attempts that reached SUBMITTED or later make "skipped" meaningful - one
// still in progress just hasn't reached that question yet, so it isn't counted as skipped or answered either way.
const COMPLETED_STATUSES = attemptRules.NONTERMINAL.filter((s) => !attemptRules.OPEN_STATES.has(s));

const asAdmin = (actor, fn) => store.withScope(store.superAdminScope(actor.adminUserId), fn, { transaction: true });
const actorOf = (actor) => ({ actorType: 'ADMIN', actorId: actor.adminUserId });

/** Best-effort audit of a rejected upload in its own transaction (counts and the first 20 codes only; no participant data). */
async function auditRejected(actor, { fileName, fileHash, ageGroup, problems, correlationId }) {
  try {
    await asAdmin(actor, (tx) => writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_UPLOAD_REJECTED', targetEntity: 'assessment_version',
      newState: { fileName, fileSha256: fileHash, ageGroup: ageGroup || null, problemCount: problems.length, firstCodes: problems.slice(0, 20).map((p) => p.code) }, correlationId,
    }));
  } catch (e) { /* the rejection itself is what the caller reports */ }
}

/**
 * Validates a spreadsheet WITHOUT saving anything - the admin reviews this summary (and, on a clean file, a preview
 * of what would be added) before a separate call to `upload()` actually commits it. Never writes to the database and
 * never audits (there is nothing yet to have happened); `upload()` keeps its own existing audit trail unchanged.
 * @returns {{ ok: boolean, problems, totalProblems, warnings, versionLabel, questionCount, activeCount, hiddenCount, domains }}
 */
function preview({ buffer, fileName, ageGroup }) {
  const parsed = parseQuestionWorkbook(buffer, { fileName });
  const checked = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup });
  const problems = [...parsed.errors, ...checked.errors];
  const warnings = [...parsed.warnings, ...checked.warnings];
  const questions = checked.questions;
  const activeCount = questions.filter((q) => q.status === 'ACTIVE').length;
  return {
    ok: problems.length === 0,
    problems: problems.slice(0, SHOWN_PROBLEMS),
    totalProblems: problems.length,
    warnings,
    versionLabel: checked.versionLabel,
    questionCount: questions.length,
    activeCount,
    hiddenCount: questions.length - activeCount,
    domains: [...new Set(questions.map((q) => q.domain_code))].sort(),
  };
}

/**
 * Uploads a spreadsheet as a draft question set.
 * @returns {{ status: 201|200, body }}
 */
async function upload({ buffer, fileName, ageGroup, actor, correlationId = null }) {
  const parsed = parseQuestionWorkbook(buffer, { fileName }); // 413 / 415 for size and type
  const fileHash = canonical.fileHash(buffer);
  const checked = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup });
  const problems = [...parsed.errors, ...checked.errors];
  if (problems.length) {
    await auditRejected(actor, { fileName, fileHash, ageGroup, problems, correlationId });
    const e = new HttpError(422, 'UPLOAD_VALIDATION_FAILED', `The file has ${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing was saved.`, problems.slice(0, SHOWN_PROBLEMS));
    e.totalProblems = problems.length;
    throw e;
  }

  const questions = checked.questions;
  const label = checked.versionLabel;
  const contentHash = canonical.contentHash(questions);
  const [minAge, maxAge] = rules.ageRange(ageGroup);
  const warnings = [...parsed.warnings, ...checked.warnings];
  const optionCount = questions.reduce((n, q) => n + q.options.length, 0);

  const result = await asAdmin(actor, async (tx) => {
    const revisions = await sets.findRevisions(tx, label);
    const decision = rules.decideUpload(revisions, contentHash);
    rules.assertUploadable(decision);

    if (decision.action === 'NOOP') {
      return { created: false, set: await sets.withCounts(tx, decision.latest), supersededRevision: null };
    }

    let superseded = null;
    if (decision.action === 'REVISE') {
      if (!(await sets.retireDraft(tx, decision.latest._id))) throw new HttpError(409, 'SET_NOT_DRAFT', 'The draft changed while uploading; try again');
      superseded = decision.latest.revision;
    }
    const revision = decision.nextRevision;
    const setId = canonical.setId(label, revision);
    const now = new Date();
    const setDoc = {
      _id: setId, version_label: label, revision, configuration: ageGroup, participant_min_age: minAge, participant_max_age: maxAge,
      content_hash: contentHash, source_file_hash: fileHash, frozen_at: null, status: 'DRAFT', participation_state: 'CLOSED', created_at: now,
    };
    const items = questions.map((q) => ({
      _id: canonical.itemId(setId, q.item_code), assessment_version_id: setId, item_code: q.item_code, domain_code: q.domain_code,
      subdomain_code: q.subdomain_code, subdomain_name: q.subdomain_name, item_text: q.item_text, keying: q.keying, age_band: q.age_band,
      context: q.context, layer: q.layer, pilot_status: q.pilot_status, display_order: q.display_order, status: q.status,
      item_content_hash: canonical.itemContentHash(q), created_at: now, options: q.options,
    }));
    await sets.insertSetWithItems(tx, setDoc, items);
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_UPLOADED', targetEntity: 'assessment_version', targetId: setId,
      previousState: superseded ? { revision: superseded } : null,
      newState: { versionLabel: label, revision, ageGroup, questionCount: questions.length, optionCount, contentHash, fileName, fileSha256: fileHash },
      correlationId,
    });
    return { created: true, set: { ...setDoc, question_count: questions.length, option_count: optionCount }, supersededRevision: superseded };
  });

  return {
    status: result.created ? 201 : 200,
    body: { ...sets.toApi(result.set), created: result.created, supersededRevision: result.supersededRevision, warnings },
  };
}

async function list(actor, filters = {}) {
  return store.withScope(store.superAdminScope(actor.adminUserId), async (tx) => (await sets.listSets(tx, filters)).map(sets.toApi));
}

async function get(actor, setId) {
  return store.withScope(store.superAdminScope(actor.adminUserId), async (tx) => {
    const set = await sets.getSetRaw(tx, setId);
    if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
    const items = await sets.questionsOf(tx, setId);
    const summary = { ...set, question_count: items.length, option_count: items.reduce((n, i) => n + i.options.length, 0) };
    return {
      ...sets.toApi(summary),
      questions: items.map((i) => ({
        itemId: i._id, itemCode: i.item_code, order: i.display_order, domainCode: i.domain_code, subdomainCode: i.subdomain_code, subdomainName: i.subdomain_name,
        text: i.item_text, keying: i.keying, ageBand: i.age_band, context: i.context, layer: i.layer, options: i.options, status: i.status,
      })),
    };
  });
}

/** Loads a set for a lifecycle move; 404 when it does not exist. */
async function loadSet(tx, setId) {
  const set = await sets.getSetRaw(tx, setId);
  if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
  return set;
}

const summarise = async (tx, set) => sets.toApi(await sets.withCounts(tx, set));

/** DRAFT -> FROZEN. Needs every domain to have an eligible question and an intact content hash. Audited. */
async function freeze(actor, setId, correlationId = null) {
  return asAdmin(actor, async (tx) => {
    const set = await loadSet(tx, setId);
    const items = await sets.questionsOf(tx, setId);
    rules.assertFreezable(set, items);
    if (!(await sets.freeze(tx, setId, set.content_hash))) throw new HttpError(409, 'SET_NOT_DRAFT', 'The set changed while freezing; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_FROZEN', targetEntity: 'assessment_version', targetId: setId,
      previousState: { status: 'DRAFT' }, newState: { status: 'FROZEN', contentHash: set.content_hash, questionCount: items.length }, correlationId,
    });
    return summarise(tx, await sets.getSetRaw(tx, setId));
  });
}

/** FROZEN + CLOSED -> OPEN. One open set per age group is enforced by the store (uq_one_open_set_per_age_group). Audited with a reason. */
async function open(actor, setId, reason, correlationId = null) {
  return asAdmin(actor, async (tx) => {
    const set = await loadSet(tx, setId);
    rules.assertOpenable(set);
    const items = await sets.questionsOf(tx, setId);
    if (!rules.verifyContentHash(set, items)) throw new HttpError(503, 'CATALOG_DRIFT', 'The stored questions do not match the set fingerprint');
    if (!(await sets.open(tx, setId))) throw new HttpError(409, 'SET_NOT_FROZEN', 'The set changed while opening; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_OPENED', targetEntity: 'assessment_version', targetId: setId,
      previousState: { participationState: 'CLOSED' }, newState: { participationState: 'OPEN', ageGroup: set.configuration }, reason, correlationId,
    });
    return summarise(tx, await sets.getSetRaw(tx, setId));
  });
}

/** OPEN -> CLOSED. New attempts are refused; attempts already started keep their set and their answers. Audited with a reason. */
async function close(actor, setId, reason, correlationId = null) {
  return asAdmin(actor, async (tx) => {
    const set = await loadSet(tx, setId);
    rules.assertClosable(set);
    if (!(await sets.close(tx, setId))) throw new HttpError(409, 'SET_NOT_FROZEN', 'The set changed while closing; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_CLOSED', targetEntity: 'assessment_version', targetId: setId,
      previousState: { participationState: 'OPEN' }, newState: { participationState: 'CLOSED' }, reason, correlationId,
    });
    return summarise(tx, await sets.getSetRaw(tx, setId));
  });
}

/**
 * DRAFT -> RETIRED, as a delete (CR-006-12). Reuses the exact same compare-and-set move the upload path already trusts to
 * retire a superseded draft; the only difference is who asked and why. Items are Tier A (insert-only) so they are never
 * physically removed - they simply belong to a RETIRED set from here on, which is never listed as an option to freeze, open
 * or upload against again. A frozen set is refused by assertDeletable before any of this runs.
 */
async function deleteDraft(actor, setId, correlationId = null) {
  return asAdmin(actor, async (tx) => {
    const set = await loadSet(tx, setId);
    rules.assertDeletable(set);
    if (!(await sets.retireDraft(tx, setId))) throw new HttpError(409, 'SET_NOT_DRAFT', 'The set changed while deleting; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: 'QUESTION_SET_DELETED', targetEntity: 'assessment_version', targetId: setId,
      previousState: { status: 'DRAFT' }, newState: { status: 'RETIRED' }, correlationId,
    });
    return summarise(tx, await sets.getSetRaw(tx, setId));
  });
}

/**
 * Shows or hides one question from participants (status ACTIVE / RETIRED) - only on a FROZEN set; a DRAFT set's
 * questions are still being edited by re-uploading, so there is nothing to show or hide yet. Refused if it would
 * leave the question's domain with none showing (rules.assertItemStatusChange). Content and options never change
 * either way - the question is still there for admin review, just not delivered. Audited with a reason.
 */
async function setItemStatus(actor, setId, itemId, status, reason, correlationId = null) {
  return asAdmin(actor, async (tx) => {
    const set = await loadSet(tx, setId);
    if (set.status !== 'FROZEN') throw new HttpError(409, 'SET_NOT_FROZEN', 'Only a frozen question set has questions to show or hide');
    const items = await sets.questionsOf(tx, setId);
    const item = items.find((i) => i._id === itemId);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Question not found in this set');
    rules.assertItemStatusChange(item, items, set.configuration, status);
    if (!(await sets.setItemStatus(tx, itemId, item.status, status))) throw new HttpError(409, 'INVALID_STATE', 'The question changed while updating; try again');
    await writeAudit(tx, {
      ...actorOf(actor), actionType: status === 'RETIRED' ? 'QUESTION_ITEM_HIDDEN' : 'QUESTION_ITEM_SHOWN', targetEntity: 'items', targetId: itemId,
      previousState: { status: item.status }, newState: { status }, reason, correlationId,
    });
    return { itemId, status };
  });
}

/**
 * Per-question response distribution for one assessment (ASSUMED read-only addition, same basis as submissionService's
 * raw-answers view - the contract never specified this report). For every question in the set: how many completed
 * attempts chose each option, and how many left it unanswered. Aggregate counts only, never a participant's individual
 * answers, so unlike submissionService.responses this is not audited (same reasoning as the unaudited get()/list() above).
 */
async function responseDistribution(actor, setId) {
  return store.withScope(store.superAdminScope(actor.adminUserId), async (tx) => {
    const set = await sets.getSetRaw(tx, setId);
    if (!set) throw new HttpError(404, 'NOT_FOUND', 'Question set not found');
    const items = await sets.questionsOf(tx, setId);
    const attempts = await tx.c.assessment_attempts.find({ assessment_version_id: setId, status: { $in: COMPLETED_STATUSES } }, { projection: { _id: 1 } });
    const attemptIds = attempts.map((a) => a._id);
    const totalAttempts = attemptIds.length;

    const counted = await responsesRepo.distributionByItem(tx, attemptIds);
    const byItem = new Map(); // itemId -> Map(position string -> count)
    for (const row of counted) {
      if (!byItem.has(row._id.itemId)) byItem.set(row._id.itemId, new Map());
      byItem.get(row._id.itemId).set(row._id.position, row.count);
    }

    const summary = { ...set, question_count: items.length, option_count: items.reduce((n, i) => n + i.options.length, 0) };
    return {
      ...sets.toApi(summary),
      totalAttempts,
      items: items.map((i) => {
        const counts = byItem.get(i._id) || new Map();
        const options = i.options.map((o) => ({ position: o.position, text: o.text, count: counts.get(String(o.position)) || 0 }));
        const answeredCount = options.reduce((n, o) => n + o.count, 0);
        return {
          itemId: i._id, itemCode: i.item_code, domainCode: i.domain_code, displayOrder: i.display_order, questionText: i.item_text,
          status: i.status, options, answeredCount, skippedCount: totalAttempts - answeredCount,
        };
      }).sort((x, y) => (x.displayOrder ?? 0) - (y.displayOrder ?? 0)),
    };
  });
}

module.exports = { preview, upload, list, get, freeze, open, close, deleteDraft, setItemStatus, responseDistribution, SHOWN_PROBLEMS };

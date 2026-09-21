/*
 * Question-set service (spec US2/US4). One transaction per action: validate -> decide -> write -> audit. A rejected upload
 * stores nothing except one audit row. The uploaded file bytes are never retained (only their SHA-256 in the audit trail).
 */
const { HttpError } = require('../../../shared/errors');
const store = require('../store');
const sets = require('../store/repositories/questionSets');
const { writeAudit } = require('../audit/auditService');
const rules = require('../domain/questionSetRules');
const canonical = require('./canonical');
const { parseQuestionWorkbook } = require('./questionSetParser');
const { validate } = require('./questionSetValidator');

const SHOWN_PROBLEMS = 200;

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
        text: i.item_text, keying: i.keying, ageBand: i.age_band, context: i.context, layer: i.layer, options: i.options,
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

module.exports = { upload, list, get, freeze, open, close, SHOWN_PROBLEMS };

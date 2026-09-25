/*
 * Identity repository: participants, institutions, cohorts, participant_cohort_history, admin_users. Built on the scoped
 * collections (tx.c), so every read is scope-filtered. Returns camelCase objects with the API id names. Only the permitted
 * mutations exist: participant / institution / cohort / admin status and edits (data-model section 2).
 */
const { camel } = require('../db/naming');

const P = (d) => camel(d, 'participantId');
const I = (d) => camel(d, 'institutionId');
const C = (d) => camel(d, 'cohortId');
const A = (d) => camel(d, 'adminUserId');

// ---- participants
async function getParticipant(tx, participantId) {
  return P(await tx.c.participants.findOne({ _id: participantId }));
}

async function findParticipantByAuthSubject(tx, provider, subjectId) {
  return P(await tx.c.participants.findOne({ auth_provider: provider, auth_provider_subject_id: subjectId }));
}

async function findParticipantBySantulanId(tx, santulanId) {
  return P(await tx.c.participants.findOne({ santulan_id: santulanId }));
}

/** Inserts a fully built participant document (see domain/registrationRules.buildParticipant). */
async function insertParticipant(tx, doc) {
  await tx.c.participants.insertOne(doc);
  return P(doc);
}

/** Compare-and-set status change (suspend / reactivate / withdraw). True when it changed. */
async function transitionParticipantStatus(tx, participantId, from, to) {
  return tx.c.participants.transition(participantId, { status: from }, { status: to, updated_at: new Date() });
}

async function listParticipants(tx, filter = {}, options = {}) {
  return (await tx.c.participants.find(filter, options)).map(P);
}

// ---- institutions and cohorts
async function getInstitution(tx, institutionId) {
  return I(await tx.c.institutions.findOne({ _id: institutionId }));
}

async function getCohort(tx, cohortId) {
  return C(await tx.c.cohorts.findOne({ _id: cohortId }));
}

async function insertInstitution(tx, doc) { await tx.c.institutions.insertOne(doc); return I(doc); }
async function insertCohort(tx, doc) { await tx.c.cohorts.insertOne(doc); return C(doc); }

async function listInstitutions(tx, filter = {}, options = {}) { return (await tx.c.institutions.find(filter, options)).map(I); }
async function listCohorts(tx, filter = {}, options = {}) { return (await tx.c.cohorts.find(filter, options)).map(C); }

/** An ACTIVE cohort of an ACTIVE institution, with the cohort belonging to that institution (cross-document rule). */
async function findActiveScope(tx, institutionId, cohortId) {
  const inst = await tx.c.institutions.findOne({ _id: institutionId, status: 'ACTIVE' });
  if (!inst) return null;
  const coh = await tx.c.cohorts.findOne({ _id: cohortId, institution_id: institutionId, status: 'ACTIVE' });
  return coh ? { institution: I(inst), cohort: C(coh) } : null;
}

// ---- admin users
async function getAdmin(tx, adminUserId) {
  return A(await tx.c.admin_users.findOne({ _id: adminUserId }));
}

async function findAdminByAuthSubject(tx, provider, subjectId) {
  return A(await tx.c.admin_users.findOne({ auth_provider: provider, auth_provider_subject_id: subjectId }));
}

async function insertAdmin(tx, doc) { await tx.c.admin_users.insertOne(doc); return A(doc); }

async function transitionAdminStatus(tx, adminUserId, from, to) {
  return tx.c.admin_users.transition(adminUserId, { status: from }, { status: to, updated_at: new Date() });
}

// ---- cohort history (append only)
async function appendCohortHistory(tx, doc) { await tx.c.participant_cohort_history.insertOne(doc); return camel(doc, 'historyId'); }

module.exports = {
  getParticipant, findParticipantByAuthSubject, findParticipantBySantulanId, insertParticipant, transitionParticipantStatus, listParticipants,
  getInstitution, getCohort, insertInstitution, insertCohort, listInstitutions, listCohorts, findActiveScope,
  getAdmin, findAdminByAuthSubject, insertAdmin, transitionAdminStatus,
  appendCohortHistory,
  fromParticipant: P, fromInstitution: I, fromCohort: C, fromAdmin: A,
};

/*
 * DEV-ONLY credential store (spec 005 decision D-17; CR-006-7): collection `dev_identity_credentials`, outside the 27
 * canonical collections. Holds bcrypt hashes for the dev identity adapter; refused in production by the adapter. Reads and
 * writes need the privileged (SYSTEM) scope.
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../db/naming');

const D = (d) => camel(d, 'credentialId');

async function findCredential(tx, provider, subjectId) {
  return D(await tx.c.dev_identity_credentials.findOne({ provider, subject_id: subjectId }));
}

/** Creates or replaces the credential as a TEMPORARY one (must_change = true); any previous secret stops working. */
async function upsertTemporary(tx, provider, subjectId, secretHash) {
  const now = new Date();
  const existing = await tx.c.dev_identity_credentials.findOne({ provider, subject_id: subjectId });
  if (!existing) {
    await tx.c.dev_identity_credentials.insertOne({ _id: uuidv4(), provider, subject_id: subjectId, secret_hash: secretHash, must_change: true, status: 'active', created_at: now, updated_at: now });
    return { updatedAt: now };
  }
  await tx.c.dev_identity_credentials.updateOne({ _id: existing._id }, { $set: { secret_hash: secretHash, must_change: true, status: 'active', updated_at: now } });
  return { updatedAt: now };
}

/** Sets a permanent password only while the credential is a temporary, active one. Returns { ok, updatedAt }. */
async function replaceTemporary(tx, provider, subjectId, secretHash) {
  const now = new Date();
  const cur = await tx.c.dev_identity_credentials.findOne({ provider, subject_id: subjectId, must_change: true, status: 'active' });
  if (!cur) return { ok: false, updatedAt: null };
  const r = await tx.c.dev_identity_credentials.updateOne({ _id: cur._id, must_change: true, status: 'active' }, { $set: { secret_hash: secretHash, must_change: false, updated_at: now } });
  return { ok: r.modified === 1, updatedAt: r.modified === 1 ? now : null };
}

/** Seeds or overwrites a permanent (must_change = false) credential. Used by the dev seeder, and by OPEN registration
 * (the participant chooses their own password up front - no temporary-password step). */
async function upsertPermanent(tx, provider, subjectId, secretHash) {
  const now = new Date();
  const existing = await tx.c.dev_identity_credentials.findOne({ provider, subject_id: subjectId });
  if (!existing) {
    await tx.c.dev_identity_credentials.insertOne({ _id: uuidv4(), provider, subject_id: subjectId, secret_hash: secretHash, must_change: false, status: 'active', created_at: now, updated_at: now });
  } else {
    await tx.c.dev_identity_credentials.updateOne({ _id: existing._id }, { $set: { secret_hash: secretHash, must_change: false, status: 'active', updated_at: now } });
  }
  return { updatedAt: now };
}

async function disableCredential(tx, provider, subjectId) {
  await tx.c.dev_identity_credentials.updateOne({ provider, subject_id: subjectId }, { $set: { status: 'disabled', updated_at: new Date() } });
}

module.exports = { findCredential, upsertTemporary, replaceTemporary, upsertPermanent, disableCredential };

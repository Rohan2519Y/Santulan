/*
 * consents repository. The only update path is the compare-and-set transition of the consent machine (data-model section 2);
 * participant, type and protocol version of a consent are never updated.
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../naming');

const K = (d) => camel(d, 'consentId');

async function getConsent(tx, consentId) {
  return K(await tx.c.consents.findOne({ _id: consentId }));
}

async function listForParticipant(tx, participantId) {
  return (await tx.c.consents.find({ participant_id: participantId }, { sort: { created_at: 1, _id: 1 } })).map(K);
}

/** Creates a PENDING consent. */
async function createConsent(tx, { participantId, consentType, giverRelationship, protocolVersion }) {
  const doc = {
    _id: uuidv4(), participant_id: participantId, consent_type: consentType, giver_relationship: giverRelationship, protocol_version: protocolVersion,
    verification_method: null, granted_at: null, verified_at: null, withdrawn_at: null, status: 'PENDING', created_at: new Date(),
  };
  await tx.c.consents.insertOne(doc);
  return K(doc);
}

/** Moves a consent from `from` to `to` only if it is still in `from`. Returns the updated consent, or null on a stale state. */
async function transitionConsent(tx, consentId, from, to, patch = {}) {
  const now = new Date();
  const set = { status: to, ...patch };
  if (to === 'GRANTED') set.granted_at = now;
  if (to === 'VERIFIED') set.verified_at = now;
  if (to === 'WITHDRAWN') set.withdrawn_at = now;
  const done = await tx.c.consents.transition(consentId, { status: from }, set);
  return done ? getConsent(tx, consentId) : null;
}

module.exports = { getConsent, listForParticipant, createConsent, transitionConsent };

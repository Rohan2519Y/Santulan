/*
 * The seven canonical capability domains (BUILD 00 §5 / Development Reporting Master 04_Subdomain_Master_Ref). The radar shows
 * exactly these seven axes with their full labels.
 */
const DOMAIN_ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];

const DOMAIN_NAMES = {
  C1: 'Body & Self-Regulation',
  C2: 'Emotional Capability',
  C3: 'Relational & Social Capability',
  C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency',
  C6: 'Adaptability & Resilience',
  C7: 'Self-Directed Learning & Executive Capability',
};

/** Evidence states that permit participant-facing developmental feedback (BUILD 07 §11: S2-S5; S0/S1/SH never). */
const REPORTABLE_STATES = new Set(['S2', 'S3', 'S4', 'S5']);

module.exports = { DOMAIN_ORDER, DOMAIN_NAMES, REPORTABLE_STATES };

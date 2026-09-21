/*
 * Report rules (BUILD 07; contracts/scoring-and-report.md sections 5-9). The report state machine, exact-match controlled wording
 * (fail closed) and the report fingerprint. Rendering itself is in reporting/reportRenderer.js and is deterministic: the same
 * frozen inputs and content versions always give the same sections and the same content_hash.
 */
const { HttpError } = require('../../../shared/errors');
const { fingerprint } = require('./fingerprint');

const TRANSITIONS = {
  PENDING: ['REPORT_READY', 'FAILED_RETRYABLE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'],
  FAILED_RETRYABLE: ['PENDING'],
  REPORT_READY: [],
  UNDER_REVIEW: [], // terminal: no exit is specified until a change record defines the human process
  NOT_ELIGIBLE: [],
};
const TERMINAL = new Set(['REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE']);
const PARTICIPANT_VISIBLE = TERMINAL;
const DESCRIPTIVE_LAYERS = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'];
const VISIBLE_LAYERS = new Set(['PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'UNDER_REVIEW', 'NOT_ELIGIBLE']);
const HIDDEN_LAYERS = new Set(['PRIORITY', 'ACTION']);

const canMove = (from, to) => (TRANSITIONS[from] || []).includes(to);

const wordingMissing = (detail) => {
  const e = new HttpError(500, 'WORDING_MISSING', 'No approved wording exists for a required report layer');
  e.detail = detail; // never sent to participants: internal diagnostics only
  return e;
};

/**
 * The effective approved wording for one exact dimension: a band-specific rule wins over a band-less one (the plain-language D1
 * variant policy), otherwise the band-less rule; the layer, evidence state and locale must match exactly. Null when none exists.
 */
function pickWording(rules, { layer, domain, state, band, locale = 'en' }) {
  const fits = rules.filter((r) => r.layer === layer && r.domainCode === domain && r.evidenceState === state && r.locale === locale && (r.developmentalBand === band || r.developmentalBand === null));
  if (!fits.length) return null;
  fits.sort((a, b) => (Number(b.developmentalBand === band) - Number(a.developmentalBand === band)) || (a.version < b.version ? 1 : a.version > b.version ? -1 : 0));
  return fits[0];
}

/** Descriptive layers are required for a domain at S2+ with usable completeness; a missing rule fails the whole report closed. */
function requireWording(rules, { layer, domain, state, band, locale }) {
  const rule = pickWording(rules, { layer, domain, state, band, locale });
  if (!rule) throw wordingMissing({ layer, domain, state, band });
  return rule;
}

/** PRIORITY / ACTION are released only with the developmentRelease switch. */
const isReleasable = (sectionType, switches) => VISIBLE_LAYERS.has(sectionType) || (HIDDEN_LAYERS.has(sectionType) && !!switches.developmentRelease);

module.exports = {
  TRANSITIONS, TERMINAL, PARTICIPANT_VISIBLE, DESCRIPTIVE_LAYERS, VISIBLE_LAYERS, HIDDEN_LAYERS,
  canMove, pickWording, requireWording, isReleasable, fingerprint, wordingMissing,
};

/*
 * Pathway rules (BUILD 07 sections 13-16; Development Reporting Master 09_Pathway_Routing; data-model section 7). Precedence
 * P5 > P4 > P3 > P2 > P1; "P0" blocks (no decision is created); a score alone never creates P3 / P4; human-support routes need a
 * human or participant basis and, for a minor, the verified consent / assent; P1 needs a participant-selected priority; P5 is
 * unconditional (never gated by a release switch, any attempt state) and only from a Q09 / safeguarding / crisis trigger.
 */
const { HttpError } = require('../../../shared/errors');
const { REPORTABLE_STATES } = require('../reporting/domains');

const PRECEDENCE = ['P5', 'P4', 'P3', 'P2', 'P1'];
const HELD_SUBDOMAINS = new Set(['C4.2', 'C2.10']); // interpretation holds: no automated route may come from them (M08)
const P5_TRIGGERS = new Set(['Q09', 'SAFEGUARDING', 'CRISIS']);
const SCORE_ONLY_TRIGGERS = new Set(['SCORE_ONLY', 'LOW_SCORE']);

const blocked = (message) => new HttpError(422, 'PATHWAY_NOT_ALLOWED', message);

/** The route that governs when several exist: P5 > P4 > P3 > P2 > P1 (null when none). */
const effectiveRoute = (codes) => PRECEDENCE.find((c) => codes.includes(c)) || null;

const isP5Trigger = (trigger) => P5_TRIGGERS.has(String(trigger || '').trim().toUpperCase());

function assertP5Trigger(trigger) {
  if (!isP5Trigger(trigger)) throw blocked('P5 fires only from a Q09, safeguarding or crisis trigger');
}

/**
 * Validates an ordinary (P1-P4) decision. `ctx`: { attemptStatus, isMinor, gateOpen, domainScore, hasSelectedPriority }.
 * Throws PATHWAY_NOT_ALLOWED (422); returns the evidence state to record.
 */
function assertOrdinaryAllowed(body, ctx) {
  if (['QUALITY_HOLD', 'INVALID'].includes(ctx.attemptStatus)) throw blocked('No ordinary pathway comes from an attempt that is on hold or not valid');
  if (body.subdomainCode && HELD_SUBDOMAINS.has(body.subdomainCode)) throw blocked('No automated pathway comes from a construct whose interpretation is on hold');
  const trigger = String(body.triggerCode || '').trim().toUpperCase();
  if (['P3', 'P4'].includes(body.pathwayCode)) {
    if (SCORE_ONLY_TRIGGERS.has(trigger)) throw blocked('A score alone cannot create a counsellor or specialist route');
    if (body.decisionSource === 'SYSTEM') throw blocked('A counsellor or specialist route needs a participant request or an authorised human decision, not an automated one');
    if (body.pathwayCode === 'P4' && body.decisionSource !== 'HUMAN_REVIEW') throw blocked('A specialist referral needs an authorised professional judgement');
    if (ctx.isMinor && !ctx.gateOpen) throw blocked('A support handoff for a minor waits for the verified consent and assent');
  }
  let evidence = 'S0'; // no domain: no capability interpretation is relied upon (ASSUMED, D-11)
  if (body.domainCode) {
    if (!ctx.domainScore) throw blocked('The attempt has no result for that domain');
    evidence = ctx.domainScore.scoreStatus;
    if (['P1', 'P2'].includes(body.pathwayCode) && !REPORTABLE_STATES.has(evidence)) throw blocked('No developmental route from an insufficient, research-only or held domain');
  }
  if (body.pathwayCode === 'P1') { // T04 / M01: eligible domain + a participant-selected priority; otherwise M11 -> P0
    if (!body.domainCode) throw blocked('A self-guided route needs a domain with a participant-selected priority');
    if (!ctx.hasSelectedPriority) throw blocked('No participant-selected priority yet: return to reflection');
  }
  return evidence;
}

module.exports = { PRECEDENCE, HELD_SUBDOMAINS, P5_TRIGGERS, effectiveRoute, isP5Trigger, assertP5Trigger, assertOrdinaryAllowed, blocked };

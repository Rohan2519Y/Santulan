/*
 * Growth rules (BUILD 07 sections 11-12; Development Reporting Master 08_Growth_Plan_Engine; data-model section 7). Replaces the
 * SQL priority / goal / action guards.
 *   - a priority comes only from a reportable (S2-S5) domain with a score, on a SCORED / REPORT_READY attempt;
 *     S0, S1, SH and held-interpretation domains never qualify;
 *   - at most three priorities are participant-selected per plan;
 *   - a goal converts a SELECTED priority; a selected action must be ACTIVE and belong to the priority's domain, must not be a
 *     held-interpretation action (C4.2 Self-Worth, C2.10 Savoring), and one whose library control asks for safety / context
 *     handling needs a fallback / support plan on the goal.
 */
const { HttpError } = require('../../../shared/errors');
const { REPORTABLE_STATES } = require('../reporting/domains');

const MAX_SELECTED = 3;
const HELD_SUBDOMAINS = new Set(['C4.2', 'C2.10']);

const notEligible = (message) => new HttpError(422, 'PRIORITY_NOT_ELIGIBLE', message);

/** Heuristic, deliberately conservative: refuses the trait / feeling goals the source names ("be confident") and asks for a behaviour. */
const TRAIT_GOAL = /\b(be|become|feel|get|stay|being|am|is|are)\s+(more\s+|a\s+|an\s+|very\s+|so\s+)?(confident|happy|motivated|resilient|smart|positive|optimistic|calm|strong|brave|intelligent|successful|perfect|better|good|productive)\b/i;

function assertObservableGoal(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length < 3 || TRAIT_GOAL.test(text)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Describe one thing you will do that you or someone else could notice, rather than a trait or a feeling');
  }
}

/** A priority candidate is eligible only from a reportable domain result on a scored attempt. */
function isEligibleDomain(attemptStatus, score) {
  return ['SCORED', 'REPORT_READY'].includes(attemptStatus) && !!score && score.rawScore !== null && REPORTABLE_STATES.has(score.scoreStatus);
}

function assertPriorityEligible(attemptStatus, score) {
  if (!isEligibleDomain(attemptStatus, score)) throw notEligible('A priority comes only from a reportable domain of a scored attempt');
}

function assertCanSelect(selectedCount) {
  if (selectedCount >= MAX_SELECTED) throw notEligible(`At most ${MAX_SELECTED} priorities can be chosen`);
}

function assertGoalFromSelected(priority) {
  if (!priority.participantSelected) throw notEligible('Choose this priority before setting a goal for it');
}

/** `action` is a development_actions document (snake_case). */
function assertActionSelectable(priorityDomain, action, fallbackAction) {
  if (!action || !action.active || action.domain_code !== priorityDomain) throw notEligible('That action is not available for this priority'); // inactive rows are invisible to a participant
  const control = String((action.control_flags && action.control_flags.control) || '');
  if (/REPORTING HOLD/i.test(action.evidence_status || '') || /interpretation hold/i.test(control) || HELD_SUBDOMAINS.has(action.subdomain_code)) {
    throw notEligible('That action is not available for this priority'); // held interpretation: never auto-targeted
  }
  if (/^Safety\/context/i.test(control) && !fallbackAction) throw notEligible('This kind of action needs a fallback or support plan on the goal first');
}

module.exports = { MAX_SELECTED, HELD_SUBDOMAINS, assertObservableGoal, isEligibleDomain, assertPriorityEligible, assertCanSelect, assertGoalFromSelected, assertActionSelectable, notEligible };

/*
 * Server-defined inactivity timeout (BUILD 05 sections 4, 7), on the store. When SESSION_INACTIVITY_MINUTES is set, attempts that
 * have been IN_PROGRESS with no activity for that long are paused (PAUSE + SESSION_END, no session increment). The duration is an
 * unfrozen UX/governance decision, so the worker is DISABLED when the variable is unset or invalid - nothing is invented.
 * A network blip alone never ends a session; only this timeout or an explicit pause/logout does.
 */
const config = require('../../config');
const store = require('../../modules/santulan/store');
const delivery = require('../../modules/santulan/store/repositories/delivery');
const attemptRules = require('../../modules/santulan/domain/attemptRules');

const BATCH = 100;

/** Pauses every timed-out attempt once; returns the number paused. Each attempt is its own transaction. */
async function runOnce({ minutes = config.sessionInactivityMinutes } = {}) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const cutoff = new Date(Date.now() - minutes * 60000);
  const due = await store.withScope(store.systemScope(), (tx) => tx.c.assessment_attempts.find(
    { status: 'IN_PROGRESS', last_activity_at: { $lt: cutoff } }, { sort: { last_activity_at: 1 }, limit: BATCH, projection: { _id: 1 } },
  ));
  let paused = 0;
  for (const { _id: attemptId } of due) {
    try {
      const done = await store.withScope(store.systemScope(), async (tx) => {
        // re-check inside the transaction: the participant may have been active since the scan
        const a = await delivery.getAttempt(tx, attemptId);
        if (!a || a.status !== 'IN_PROGRESS' || !(a.lastActivityAt < cutoff)) return false;
        const plan = attemptRules.planPause(a, 'INACTIVITY_TIMEOUT');
        if (!(await delivery.moveAttempt(tx, attemptId, plan.from, plan.patch))) return false;
        for (const e of plan.events) await delivery.appendEvent(tx, a, e);
        return true;
      }, { transaction: true });
      if (done) paused += 1;
    } catch (err) {
      console.error(`inactivity worker: attempt ${attemptId} not paused (${err.code || err.message})`); // eslint-disable-line no-console
    }
  }
  return paused;
}

/** Starts the periodic worker; returns the timer, or null when disabled. */
function start({ minutes = config.sessionInactivityMinutes, intervalMs } = {}) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const every = intervalMs || Math.max(15000, Math.min(60000, (minutes * 60000) / 2));
  const timer = setInterval(() => { runOnce({ minutes }).catch((err) => console.error('inactivity worker failed', err.message)); }, every); // eslint-disable-line no-console
  timer.unref();
  return timer;
}

module.exports = { runOnce, start };

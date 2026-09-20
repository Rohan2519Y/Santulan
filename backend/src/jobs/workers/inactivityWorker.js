/*
 * Server-defined inactivity timeout (BUILD 05 §4, §7). When SESSION_INACTIVITY_MINUTES is set, attempts that have been
 * IN_PROGRESS with no activity for that long are paused (PAUSE + SESSION_END, no session increment). The duration is an
 * unfrozen UX/governance decision, so the worker is DISABLED when the variable is unset or invalid - nothing is invented.
 * A network blip alone never ends a session; only this timeout or an explicit pause/logout does.
 */
const config = require('../../config');
const { withSystemTx } = require('../../modules/santulan/context/canonicalTx');

const BATCH = 100;

/** Pauses every timed-out attempt once; returns the number paused. Each attempt is its own transaction. */
async function runOnce({ minutes = config.sessionInactivityMinutes } = {}) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const due = await withSystemTx(async (tx) => (await tx.query(
    `SELECT attempt_id FROM santulan.assessment_attempts
      WHERE status = 'IN_PROGRESS' AND last_activity_at < now() - make_interval(mins => $1)
      ORDER BY last_activity_at LIMIT ${BATCH}`, [minutes])).rows);
  let paused = 0;
  for (const { attemptId } of due) {
    try {
      const done = await withSystemTx(async (tx) => {
        // re-check under the row lock: the participant may have been active since the scan
        const still = await tx.query(
          `SELECT 1 FROM santulan.assessment_attempts WHERE attempt_id = $1 AND status = 'IN_PROGRESS'
              AND last_activity_at < now() - make_interval(mins => $2) FOR UPDATE`, [attemptId, minutes]);
        if (!still.rowCount) return false;
        await tx.query('SELECT santulan.pause_session($1, $2)', [attemptId, 'INACTIVITY_TIMEOUT']);
        return true;
      });
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

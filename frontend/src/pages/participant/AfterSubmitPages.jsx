/*
 * Screens 16-17. Only REAL state is shown: the stage stepper follows the attempt status the server reports, there is never a
 * percentage that was not derived from state, and nothing promises "personalised insights" (the outcome may be a review or an
 * invalid attempt). QUALITY_HOLD reads the same for every reason (T11); INVALID is the neutral administrative message (T12).
 * TODO(copy): wording is placeholder text awaiting the content owner.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import { StageStepper } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import Skeleton from '../../components/Skeleton/Skeleton';
import { api } from '../../services/santulanApi';

export const STAGES = ['Answers received', 'Checking your responses', 'Preparing your report', 'Report ready'];

/** Maps real attempt (and optional report) state to the stepper position, or to a terminal notice. */
export function stageFor(status, reportStatus = null) {
  if (status === 'QUALITY_HOLD') return { terminal: 'held' };
  if (status === 'INVALID') return { terminal: 'invalid' };
  if (status === 'EXPIRED') return { terminal: 'expired' };
  if (reportStatus === 'FAILED_RETRYABLE') return { index: 2, notice: 'Still preparing your report' };
  if (status === 'REPORT_READY') return { index: 3, done: true };
  if (status === 'SCORED' || status === 'SCORING') return { index: 2 };
  if (status === 'SUBMITTED') return { index: 1 };
  return { index: 0 };
}

export function AssessmentCompletePage() {
  return (
    <div className={styles.stack}>
      <h1 className={styles.h2}>Thank you</h1>
      <p className={styles.lead}>Your answers have been received. You do not need to do anything else right now.</p>
      <div className={styles.row}>
        <Link className={styles.pageLink} to="/student/generating">See progress</Link>
        <Link className={styles.pageLink} to="/student/thanks">Read a note from us</Link>
        <Link className={styles.pageLink} to="/student">Back to my dashboard</Link>
      </div>
    </div>
  );
}

export function GeneratingReportPage({ pollMs = 5000 }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false; let timer;
    const poll = async () => {
      try {
        const reg = await api.registrationState();
        const model = reg.attempt ? await api.attempt(reg.attempt.attemptId) : null;
        if (stopped) return;
        setState(stageFor(model ? model.status : null)); setError('');
        if (model && ['SUBMITTED', 'SCORING', 'SCORED'].includes(model.status)) timer = setTimeout(poll, pollMs);
      } catch (err) { if (!stopped) { setError(err.message); timer = setTimeout(poll, pollMs * 2); } }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pollMs]);

  if (!state && !error) return <div aria-busy="true"><Skeleton /></div>;
  return (
    <div className={styles.stack}>
      <h1 className={styles.h2}>Your report</h1>
      {error && <StatusMessage type="warning" message="We could not check on your report just now. We will try again." />}
      {state && state.terminal === 'held' && <StatusMessage type="neutral" message="Your responses are being reviewed." />}
      {state && state.terminal === 'invalid' && <StatusMessage type="neutral" message="This attempt could not be processed for a report." />}
      {state && state.terminal === 'expired' && <StatusMessage type="neutral" message="This attempt has ended." />}
      {state && state.notice && <StatusMessage type="info" message={state.notice} />}
      {state && state.index !== undefined && <StageStepper stages={STAGES} currentIndex={state.done ? STAGES.length : state.index} />}
      {state && state.done && <Link className={styles.pageLink} to="/student/results">View your report</Link>}
      {state && state.terminal && <Link className={styles.pageLink} to="/student/support">Go to Support</Link>}
      <Button variant="secondary" onClick={() => window.location.assign('/student')}>Back to my dashboard</Button>
    </div>
  );
}

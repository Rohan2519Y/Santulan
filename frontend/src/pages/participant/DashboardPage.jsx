/*
 * Participant dashboard (screen 10, dashboards.md §1): a neutral greeting (no stored name), ONE primary action driven by the
 * real lifecycle state, a timeline of real stages, and a Support card. Resources, Wellbeing, mentor and notification tiles are
 * deferred (no canonical source). It reads the consent gate and the resume model only - never a score or a quality flag.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import { RailCard } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api } from '../../services/santulanApi';
import { deriveState, describeState, timeline, greeting } from './dashboardState';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const reg = await api.registrationState();
      const [gate, model] = await Promise.all([
        api.consentGate(),
        reg.attempt ? api.attempt(reg.attempt.attemptId) : Promise.resolve(null),
      ]);
      setData({ reg, gate, model });
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true); setError('');
    try { await api.createAttempt(); navigate('/student/assessment'); } catch (err) {
      if (err.code === 'ASSESSMENT_NOT_OPEN') setClosed(true); else setError(err.message);
    } finally { setBusy(false); }
  };

  if (error && !data) {
    return <div className={styles.stack}><StatusMessage type="error" message={error} /><Button onClick={load}>Try again</Button></div>;
  }
  if (!data) return <div className={styles.stack} aria-busy="true"><Skeleton /><Skeleton /><Skeleton /></div>;

  const state = deriveState({ gate: data.gate, attempt: data.reg.attempt, model: data.model, assessmentClosed: closed });
  const view = describeState(state, { isMinor: data.reg.isMinor, model: data.model });
  const steps = timeline(state, { gateOpen: data.gate.open });

  return (
    <div className={styles.stack}>
      <section className={`${styles.heroBand}`}>
        <h1 className={styles.h2}>{greeting(new Date().getHours())}</h1>
        <p className={styles.lead}>Thank you for taking the time to be here.</p>
        <p className={styles.script}>Same you. A brighter tomorrow.</p>
      </section>
      {error && <StatusMessage type="error" message={error} />}
      <section className={`${styles.card} ${styles.toneBlue}`} aria-labelledby="journey-heading">
        <div className={styles.journey}>
          <div>
            <h2 id="journey-heading" className={styles.h3}>Your journey matters</h2>
            <p><strong>{view.headline}</strong></p>
            <p className={styles.muted}>{view.body}</p>
            {state === 'consent-pending' && <p className={styles.muted}>{view.startDisabledReason}</p>}
          </div>
          <div className={styles.journeyAction}>
            {view.action && view.action.kind === 'start' && <Button onClick={start} disabled={busy}>{view.action.label}</Button>}
            {view.action && view.action.to && <Button onClick={() => navigate(view.action.to)}>{view.action.label}</Button>}
          </div>
        </div>
      </section>
      <div className={styles.tiles}>
        <section className={`${styles.card} ${styles.toneSky}`}>
          <h2 className={styles.h3}>Assessment</h2>
          <p className={styles.muted}>Your assessment, at your own pace.</p>
          <Link className={styles.pageLink} to="/student/assessment">Open assessment</Link>
        </section>
        <section className={`${styles.card} ${styles.toneLavender}`}>
          <h2 className={styles.h3}>Support</h2>
          <p className={styles.muted}>Help is available if you need it.</p>
          <Link className={styles.pageLink} to="/student/support">Go to Support</Link>
        </section>
      </div>
      <div className={styles.dashLower}>
      <section className={styles.card} aria-labelledby="progress-heading">
        <h2 id="progress-heading" className={styles.h3}>Your progress</h2>
        <ol className={styles.timeline}>
          {steps.map((s) => (
            <li key={s.label} className={styles.timelineItem} aria-current={s.current ? 'step' : undefined}>
              <span className={`${styles.timelineMark} ${s.done ? styles.timelineDone : ''} ${s.current ? styles.timelineNow : ''}`} aria-hidden="true">{s.done ? '✓' : ''}</span>
              <span>{s.label}{s.done ? ' (done)' : s.current ? ' (in progress)' : ''}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className={styles.stack}>
        <RailCard tone="note" title="A note for you"><p>There are no right or wrong answers. TODO(copy): approved supportive note.</p></RailCard>
        <RailCard tone="help" title="Need help?"><p>Talk to someone you trust, or visit <Link className={styles.pageLink} to="/student/support">Support</Link>.</p></RailCard>
      </div>
      </div>
    </div>
  );
}

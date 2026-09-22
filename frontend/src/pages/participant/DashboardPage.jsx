/*
 * Participant dashboard (screen 10, dashboards.md §1): a neutral greeting (no stored name), ONE primary action driven by the
 * real lifecycle state, a timeline of real stages, and a Support card. Resources, Wellbeing, mentor and notification tiles are
 * deferred (no canonical source). It reads the consent gate and the resume model only - never a score or a quality flag.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChartColumn, LifeBuoy, Sprout, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { IconBadge, ButtonLink } from '../../components/participantKit';
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
    <div className={p.page}>
      <section className={p.dashHero}>
        <div className={p.dashCopy}>
          <h1 className={p.greet}>{greeting(new Date().getHours())}</h1>
          <p className={p.pageLead}>Here&apos;s your dashboard. Keep going — progress happens one step at a time.</p>
        </div>
        <p className={p.dashScript} aria-hidden="true">“Growth begins outside your comfort zone.”</p>
        <ImageSlot slot="dashboardHero" className={p.dashArt} />
      </section>
      {error && <StatusMessage type="error" message={error} />}

      <section className={p.journey} aria-labelledby="journey-heading">
        <IconBadge icon={Sprout} tone="blue" size="lg" />
        <div className={p.journeyBody}>
          <h2 id="journey-heading" className={styles.h3}>Your journey matters</h2>
          <p><strong>{view.headline}</strong></p>
          <p className={styles.muted}>{view.body}</p>
          {state === 'consent-pending' && <p className={styles.muted}>{view.startDisabledReason}</p>}
        </div>
        <div className={p.journeyAction}>
          {view.action && view.action.kind === 'start' && <Button size="lg" block onClick={start} disabled={busy}>{view.action.label} <ArrowRight size={20} aria-hidden="true" /></Button>}
          {view.action && view.action.to && <Button size="lg" block onClick={() => navigate(view.action.to)}>{view.action.label} <ArrowRight size={20} aria-hidden="true" /></Button>}
        </div>
      </section>

      <div className={p.tiles}>
        <Link className={`${p.tile} ${p.tileBlue}`} to="/student/assessment">
          <IconBadge icon={ChartColumn} tone="blue" />
          <div>
            <h2 className={p.tileTitle}>Complete Assessment</h2>
            <p className={p.tileText}>Discover your strengths and growth areas.</p>
          </div>
          <span className={p.tileGo} aria-hidden="true"><ArrowRight size={20} /></span>
        </Link>
        <Link className={`${p.tile} ${p.tileLavender}`} to="/student/support">
          <IconBadge icon={Users} tone="lavender" />
          <div>
            <h2 className={p.tileTitle}>Connect for Support</h2>
            <p className={p.tileText}>Reach out whenever you need guidance.</p>
          </div>
          <span className={p.tileGo} aria-hidden="true"><ArrowRight size={20} /></span>
        </Link>
      </div>

      <div className={p.dashLower}>
        <section className={styles.card} aria-labelledby="progress-heading">
          <h2 id="progress-heading" className={styles.h3}>Your progress</h2>
          <ol className={p.timeline}>
            {steps.map((s) => (
              <li key={s.label} className={`${p.timelineItem} ${s.done ? p.timelineDoneItem : ''}`} aria-current={s.current ? 'step' : undefined}>
                <span className={`${p.timelineMark} ${s.done ? p.timelineDone : ''} ${s.current ? p.timelineNow : ''}`} aria-hidden="true">{s.done ? <Check size={16} strokeWidth={3} /> : null}</span>
                <div>
                  <p className={p.timelineLabel}>{s.label}</p>
                  <p className={p.timelineStatus}>{s.done ? 'Completed' : s.current ? 'In progress' : 'Pending'}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <div className={styles.stack}>
          <section className={p.note}>
            <h2 className={styles.h3}>A Note for You</h2>
            <p className={p.noteScript}>“Small steps today, a brighter tomorrow.”</p>
            <p className={styles.muted} style={{ margin: 'var(--sp-2) 0 0' }}>There are no right or wrong answers. TODO(copy): approved supportive note.</p>
          </section>
          <section className={`${styles.card} ${p.help}`}>
            <IconBadge icon={LifeBuoy} tone="blue" />
            <div className={styles.stack} style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
              <div>
                <h2 className={styles.h3}>Need Help?</h2>
                <p className={styles.muted} style={{ margin: 0 }}>Our support team is here for you. Reach out anytime.</p>
              </div>
              <ButtonLink to="/student/support" variant="secondary" icon block={false}>Contact Support</ButtonLink>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

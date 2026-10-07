/*
 * Screens 16-17. Only REAL state is shown: the stage stepper follows the attempt status the server reports, there is never a
 * percentage that was not derived from state, and nothing promises "personalised insights" (the outcome may be a review or an
 * invalid attempt). QUALITY_HOLD reads the same for every reason (T11); INVALID is the neutral administrative message (T12).
 * The sample's "Explore & Act" step, the notification promise and the fake 60% bar are not built.
 * TODO(copy): wording is placeholder text awaiting the content owner.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, CircleCheck, Clock, FileText, Lightbulb, PartyPopper, Search, ShieldCheck, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { Breadcrumb, ButtonLink, IconBadge, InfoNote, RailCard, StageStepper } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import Skeleton from '../../components/Skeleton/Skeleton';
import { api } from '../../services/santulanApi';

export const STAGES = ['Answers received', 'Checking your responses', 'Preparing your report', 'Report ready'];

/** Maps real attempt (and optional report) state to the stepper position, or to a terminal notice. */
export const RELEASE_WAIT_NOTICE = 'Your report is ready. The Santulan team is checking it before it is shared with you, and it will appear here.';

/** `released` is false while a finished report has not yet been released by an admin (audit gap G-04): it is not "ready" for the student. */
export function stageFor(status, reportStatus = null, released = true) {
  if (status === 'QUALITY_HOLD') return { terminal: 'held' };
  if (status === 'INVALID') return { terminal: 'invalid' };
  if (status === 'EXPIRED') return { terminal: 'expired' };
  if (reportStatus === 'FAILED_RETRYABLE') return { index: 2, notice: 'Still preparing your report' };
  if (status === 'REPORT_READY') return released ? { index: 3, done: true } : { index: 2, notice: RELEASE_WAIT_NOTICE, waitingRelease: true };
  if (status === 'SCORED' || status === 'SCORING') return { index: 2 };
  if (status === 'SUBMITTED') return { index: 1 };
  return { index: 0 };
}

export function AssessmentCompletePage() {
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'Assessment', to: '/student/assessment' }, { label: 'Assessment complete' }]} />
        <div>
          <h1 className={p.pageTitle}>Assessment complete! <PartyPopper size={36} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', color: 'var(--c-status-warning)' }} /></h1>
          <p className={p.pageLead}>Thank you for sharing your responses. You&apos;ve taken an important step towards understanding yourself better.</p>
        </div>
        <section className={p.banner}>
          <IconBadge icon={CircleCheck} tone="green" size="lg" />
          <div>
            <h2 className={p.bannerTitle}>Your responses have been submitted successfully!</h2>
            <p className={p.bannerText}>Your answers have been received. You do not need to do anything else right now.</p>
          </div>
        </section>
        <section className={p.panel}>
          <h2 className={p.panelTitle}>What happens next?</h2>
          <p className={styles.muted} style={{ margin: 0 }}>Here&apos;s what you can expect:</p>
          <ol className={p.steps3} style={{ listStyle: 'none', padding: 0 }}>
            {[
              [Search, 'blue', '1. Analysis', 'We check your responses'],
              [FileText, 'lavender', '2. Your report', 'We prepare your report'],
              [Check, 'green', '3. Ready', 'Your report appears here when it is ready'],
            ].map(([Icon, tone, title, text]) => (
              <li key={title} className={p.step3}>
                <IconBadge icon={Icon} tone={tone} size="lg" />
                <div><p className={p.step3Title}>{title}</p><p className={p.step3Text}>{text}</p></div>
              </li>
            ))}
          </ol>
          <InfoNote icon={Clock}><strong>Estimated time:</strong> preparing your report can take a little while. You can check on it at any time.</InfoNote>
          <div className={p.buttonRow} style={{ marginTop: 'var(--sp-5)' }}>
            <ButtonLink to="/student" variant="secondary" size="lg" block={false}><ArrowLeft size={20} aria-hidden="true" /> Back to my dashboard</ButtonLink>
            <ButtonLink to="/student/generating" size="lg" icon block={false}>See progress</ButtonLink>
          </div>
          <p style={{ margin: 'var(--sp-4) 0 0' }}><Link className={styles.pageLink} to="/student/thanks">Read a note from us</Link></p>
        </section>
      </div>
      <div className={styles.rail}>
        <ImageSlot slot="completeHero" className={p.railArt} />
        <RailCard tone="sky" title="Your journey matters" icon={Lightbulb}><p>Taking time to reflect on yourself is a good first step.</p></RailCard>
        <RailCard tone="help" title="Need support?"><p>If you have any questions or want to talk to someone, our support team is here for you.</p><Link className={styles.pageLink} to="/student/support">Contact Support</Link></RailCard>
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
        let released = true;
        if (model && model.status === 'REPORT_READY') {
          // A finished report only counts as ready once an admin has released it; if we cannot tell, do not say it is ready.
          try { released = Boolean(model.reportId) && (await api.report(model.reportId)).released !== false; } catch (e) { released = false; }
        }
        if (stopped) return;
        setState(stageFor(model ? model.status : null, null, released)); setError('');
        if (model && (['SUBMITTED', 'SCORING', 'SCORED'].includes(model.status) || (model.status === 'REPORT_READY' && !released))) timer = setTimeout(poll, model.status === 'REPORT_READY' ? pollMs * 6 : pollMs);
      } catch (err) { if (!stopped) { setError(err.message); timer = setTimeout(poll, pollMs * 2); } }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pollMs]);

  if (!state && !error) return <div aria-busy="true"><Skeleton /></div>;
  const working = state && state.index !== undefined && !state.done;
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'Assessment', to: '/student/assessment' }, { label: 'Your report' }]} />
        <div>
          <h1 className={p.pageTitle}>Generating your report</h1>
          <p className={p.pageLead}>We are checking your responses and preparing your report. This will only take a few moments.</p>
        </div>
        {error && <StatusMessage type="warning" message="We could not check on your report just now. We will try again." />}
        {state && state.terminal === 'held' && <StatusMessage type="neutral" message="Your responses are being reviewed." />}
        {state && state.terminal === 'invalid' && <StatusMessage type="neutral" message="This attempt could not be processed for a report." />}
        {state && state.terminal === 'expired' && <StatusMessage type="neutral" message="This attempt has ended." />}
        {state && state.notice && <StatusMessage type="info" message={state.notice} />}
        {state && state.index !== undefined && (
          <section className={`${p.panel} ${p.processingCard}`}>
            <StageStepper stages={STAGES} currentIndex={state.done ? STAGES.length : state.index} />
            <div className={p.analysing}>
              <ImageSlot slot="generatingArt" className={p.analysingArt} />
              <h2 className={p.analysingTitle}>{state.done ? 'Your report is ready' : 'Working on your report…'}</h2>
              {working && <div className={p.busy} aria-hidden="true"><div className={p.busyFill} /></div>}
              <InfoNote icon={Lightbulb}>Good things take a little time. We&apos;re working on your report.</InfoNote>
            </div>
          </section>
        )}
        <div className={p.buttonRow}>
          <Button variant="secondary" size="lg" onClick={() => window.location.assign('/student')}>Back to my dashboard</Button>
          {state && state.done && <ButtonLink to="/student/results" size="lg" icon block={false}>View your report</ButtonLink>}
          {state && state.terminal && <ButtonLink to="/student/support" variant="secondary" size="lg" block={false}>Go to Support</ButtonLink>}
        </div>
      </div>
      <div className={styles.rail}>
        <ImageSlot slot="generatingPhoto" className={styles.railPicture} />
        <RailCard tone="sky" title="Did you know?" icon={Lightbulb}><p>Take your time. There are no right or wrong answers, and your report is about you alone.</p></RailCard>
        <RailCard tone="safe" title="Your information is safe" icon={ShieldCheck}><p>Your responses are confidential and used only to support your participation.</p></RailCard>
        <RailCard tone="help" title="Need Help?" icon={Users}><p>If you have any questions or need assistance, feel free to reach out to our support team.</p><Link className={styles.pageLink} to="/student/support">Contact Support</Link></RailCard>
      </div>
    </div>
  );
}

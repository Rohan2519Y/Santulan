/*
 * Results view. Shows ONLY what the server releases to this participant: the released report (GET /reports/{id}). The seven-axis
 * chart is drawn from the report's PROFILE section - a domain is plotted only when the server marks it PLOTTED (1.00-5.00, with its
 * completeness and status) and otherwise reads "Not enough data yet" (never plotted at 1.00). Nothing is inferred client-side. There is
 * no benchmark, no band, no comparison; the descriptive text below the chart is the approved wording the server released.
 * TODO(copy): the short labels below are placeholder text awaiting the content owner.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { Breadcrumb, RadarChart, RailCard } from '../../components/participantKit';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api } from '../../services/santulanApi';
import { DOMAIN_NAMES } from './AssessmentPage';

const STATUS_TEXT = { COMPLETE: 'Complete', COMPLETE_WITH_MISSING: 'Complete, a few answers skipped' };
const LAYER_LABEL = { MEANING: 'What this area is about', PATTERN: 'Your pattern', STRENGTH: 'A strength', GROWTH: 'Something to grow', CHANGE: 'Since your last time', PRIORITY: 'A priority to consider', ACTION: 'Small actions to try' };
const LAYER_ORDER = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'PRIORITY', 'ACTION'];

/** The PROFILE payload of the released report, or null when it is missing / unreadable. */
export const profileOf = (report) => {
  const section = report && (report.sections || []).find((s) => s.type === 'PROFILE');
  if (!section) return null;
  try { const payload = JSON.parse(section.content); return payload && Array.isArray(payload.domains) ? payload : null; } catch (err) { return null; }
};

/** Chart axes from the PROFILE payload: only PLOTTED domains carry a score. */
export const toAxes = (profile) => profile.domains.map((d) => ({
  code: d.code,
  name: d.name || DOMAIN_NAMES[d.code],
  score: d.display === 'PLOTTED' && d.score != null ? d.score : null,
  message: d.message,
  note: d.display === 'PLOTTED' ? `${Math.round((d.completeness || 0) * 100)}% answered · ${STATUS_TEXT[d.completenessStatus] || d.completenessStatus}` : null,
}));

const actionsOf = (content) => { try { const parsed = JSON.parse(content); return Array.isArray(parsed.actions) ? parsed.actions.map((a) => a.text) : [content]; } catch (err) { return [content]; } };

function DomainText({ code, sections }) {
  const mine = sections.filter((s) => s.domain === code).sort((a, b) => LAYER_ORDER.indexOf(a.type) - LAYER_ORDER.indexOf(b.type));
  if (!mine.length) return null;
  return (
    <section className={`${p.panel} ${p.domainText}`} aria-labelledby={`domain-${code}`}>
      <h2 id={`domain-${code}`} className={styles.h3}>{DOMAIN_NAMES[code]}</h2>
      {mine.map((s) => (
        <div key={`${s.type}-${s.order}`} className={p.layer}>
          <h3 className={styles.h4}>{LAYER_LABEL[s.type] || s.type}</h3>
          {s.type === 'ACTION' ? <ul>{actionsOf(s.content).map((t) => <li key={t}>{t}</li>)}</ul> : <p>{s.content}</p>}
        </div>
      ))}
    </section>
  );
}

export default function ResultsPage() {
  const [view, setView] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await api.registrationState();
        if (!reg.attempt) { if (!cancelled) setView({ none: true }); return; }
        const model = await api.attempt(reg.attempt.attemptId);
        const report = model.reportId ? await api.report(model.reportId) : null;
        if (!cancelled) setView({ status: model.status, report });
      } catch (err) { if (!cancelled) setView({ error: err.message }); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (view.loading) return <div aria-busy="true"><Skeleton /></div>;
  if (view.error) return <StatusMessage type="error" message={view.error} />;
  if (view.none) return <p>There is nothing to show yet.</p>;

  const { report } = view;
  if (report && (report.state === 'UNDER_REVIEW' || report.state === 'NOT_ELIGIBLE')) {
    return <StatusMessage type="neutral" message={(report.sections[0] && report.sections[0].content) || 'Your responses are being reviewed.'} />;
  }
  if (!report && view.status === 'QUALITY_HOLD') return <StatusMessage type="neutral" message="Your responses are being reviewed." />;
  if (!report && view.status === 'INVALID') return <StatusMessage type="neutral" message="This attempt could not be processed for a report." />;

  const awaitingRelease = Boolean(report) && report.state === 'REPORT_READY' && report.released === false; // G-04: finished, but an admin has not released it yet
  const profile = report && report.state === 'REPORT_READY' && !awaitingRelease ? profileOf(report) : null;
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'Your results' }]} />
        <h1 className={p.pageTitle}>Your results</h1>
        {!profile ? (
          <RailCard tone="sky" title={awaitingRelease ? 'Being checked' : 'Not ready yet'}>
            <p>{awaitingRelease ? 'Your report is ready. The Santulan team is checking it before it is shared with you, and it will appear here.' : 'There is nothing to show yet. We will make your report available here when it is ready.'} <Link className={styles.pageLink} to="/student/generating">See progress</Link></p>
          </RailCard>
        ) : (
          <>
            <p className={p.pageLead}>These are the areas we can show you from what you told us, on a scale from {profile.scale.min.toFixed(2)} to {profile.scale.max.toFixed(2)}.</p>
            <section className={p.panel}><RadarChart axes={toAxes(profile)} /></section>
            {Object.keys(DOMAIN_NAMES).map((code) => <DomainText key={code} code={code} sections={report.sections} />)}
          </>
        )}
      </div>
      <div className={styles.rail}>
        <ImageSlot slot="resultsHero" className={styles.railPicture} />
        <RailCard tone="safe" title="Your information is safe" icon={ShieldCheck}><p>Only you can see your report. It describes what you told us and does not compare you with anyone else.</p></RailCard>
        <RailCard tone="help" title="Need Help?" icon={Users}><p>If you would like to talk about your report, our support team is here for you.</p><Link className={styles.pageLink} to="/student/support">Contact Support</Link></RailCard>
      </div>
    </div>
  );
}

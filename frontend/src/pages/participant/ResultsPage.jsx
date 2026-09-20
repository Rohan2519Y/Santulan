/*
 * Results view. Shows ONLY what the server releases to this participant (domain results at an interpretable evidence state);
 * nothing is inferred client-side. A domain without enough data reads "Not enough data" (never zero). There is no benchmark, no
 * band, no comparison and no prescriptive content while those are gated. If nothing is released yet, the page says so calmly.
 * TODO(copy): wording is placeholder text awaiting the content owner.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import { RadarChart, RailCard } from '../../components/participantKit';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api } from '../../services/santulanApi';
import { DOMAIN_NAMES } from './AssessmentPage';

export const toAxes = (scores) => Object.keys(DOMAIN_NAMES).map((code) => {
  const row = scores.find((s) => s.domainCode === code);
  return { code, name: DOMAIN_NAMES[code], score: row && row.score != null ? row.score : null };
});

export default function ResultsPage() {
  const [view, setView] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await api.registrationState();
        if (!reg.attempt) { if (!cancelled) setView({ none: true }); return; }
        const model = await api.attempt(reg.attempt.attemptId);
        const scores = model.status === 'REPORT_READY' || model.status === 'SCORED' ? (await api.scores(reg.attempt.attemptId)).scores : [];
        if (!cancelled) setView({ status: model.status, scores });
      } catch (err) { if (!cancelled) setView({ error: err.message }); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (view.loading) return <div aria-busy="true"><Skeleton /></div>;
  if (view.error) return <StatusMessage type="error" message={view.error} />;
  if (view.none) return <p>There is nothing to show yet.</p>;
  if (view.status === 'QUALITY_HOLD') return <StatusMessage type="neutral" message="Your responses are being reviewed." />;
  if (view.status === 'INVALID') return <StatusMessage type="neutral" message="This attempt could not be processed for a report." />;

  return (
    <div className={styles.stack}>
      <h1 className={styles.h2}>Your results</h1>
      {view.scores.length === 0 ? (
        <RailCard tone="sky" title="Not ready yet">
          <p>There is nothing to show yet. We will make your report available here when it is ready. <Link className={styles.pageLink} to="/student/generating">See progress</Link></p>
        </RailCard>
      ) : (
        <>
          <p className={styles.lead}>These are the areas we can show you from what you told us, on a scale from 1.00 to 5.00.</p>
          <RadarChart axes={toAxes(view.scores)} />
        </>
      )}
    </div>
  );
}

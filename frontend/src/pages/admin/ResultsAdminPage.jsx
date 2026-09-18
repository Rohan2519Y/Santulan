import { useEffect, useState } from 'react';
import { getSubmissions, getSubmissionDetail, reviewQualityFlag } from '../../services/assessmentApi';
import Card from '../../components/Card/Card';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import ScoreCard from '../../components/ScoreCard/ScoreCard';
import FlagBadge from '../../components/FlagBadge/FlagBadge';
import Skeleton from '../../components/Skeleton/Skeleton';
import EmptyState from '../../components/EmptyState/EmptyState';
import styles from './ResultsAdminPage.module.css';

function SubmissionDetail({ attemptId, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const res = await getSubmissionDetail(attemptId);
      setDetail(res);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const disposition = async (flagId) => {
    const value = window.prompt('Disposition note:');
    if (!value) return;
    await reviewQualityFlag(flagId, value);
    load();
  };

  if (error) return <StatusMessage type="error" message={error} />;
  if (!detail) {
    return (
      <div aria-busy="true">
        <span className="sr-only" role="status">
          Loading submission…
        </span>
        <Skeleton height={24} width="50%" className={styles.skeletonGap} />
        <Skeleton height={120} />
      </div>
    );
  }

  return (
    <div>
      <Button type="button" variant="quiet-link" onClick={onBack} className={styles.backLink}>
        ← Back to submissions
      </Button>
      <h3 className={styles.detailTitle}>
        {detail.attempt.santulanId} — {detail.attempt.versionLabel}
      </h3>
      <p className={styles.detailMeta}>
        Status: {detail.attempt.status} · Session {detail.attempt.sessionCount} of 4
      </p>

      <h4 className={styles.groupTitle}>Scores</h4>
      <div className={styles.scoreGrid}>
        {detail.scores.map((s) => (
          <ScoreCard key={s.domainCode} domainName={s.domainCode} rawScore={s.rawScore} completenessRate={s.completenessRate} scoreStatus={s.scoreStatus} />
        ))}
      </div>

      <h4 className={styles.groupTitle}>Quality flags</h4>
      {detail.qualityFlags.length === 0 ? (
        <EmptyState message="No quality flags" />
      ) : (
        <ul className={styles.flagList}>
          {detail.qualityFlags.map((f) => (
            <li key={f.id} className={styles.flagRow}>
              <FlagBadge flagCode={f.flagCode} disposition={f.disposition} />
              <span className={styles.flagSeverity}>{f.severity}</span>
              {f.disposition && <span className={styles.flagNote}>{f.disposition}</span>}
              <Button type="button" variant="quiet-link" onClick={() => disposition(f.id)}>
                Review
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadingList() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading submissions…
      </span>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} height={48} className={styles.skeletonGap} />
      ))}
    </div>
  );
}

export default function ResultsAdminPage() {
  const [submissions, setSubmissions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSubmissions()
      .then((res) => setSubmissions(res.submissions))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <StatusMessage type="error" message={error} />;
  if (selected) return <SubmissionDetail attemptId={selected} onBack={() => setSelected(null)} />;
  if (!submissions) return <LoadingList />;

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Submissions</h2>
      {submissions.length === 0 ? (
        <EmptyState message="No submissions yet" />
      ) : (
        <Card className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Santulan ID</th>
                <th>Version</th>
                <th>Status</th>
                <th>Sessions</th>
                <th>Quality flags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.attemptId}>
                  <td>{s.santulanId}</td>
                  <td>{s.versionLabel}</td>
                  <td>{s.status}</td>
                  <td>{s.sessionCount}</td>
                  <td>
                    {s.qualityFlagCount > 0 ? (
                      <span className={styles.flagCountChip}>{s.qualityFlagCount}</span>
                    ) : (
                      <span className={styles.flagCountZero}>0</span>
                    )}
                  </td>
                  <td>
                    <Button type="button" variant="secondary" onClick={() => setSelected(s.attemptId)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

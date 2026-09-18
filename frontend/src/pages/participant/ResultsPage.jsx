import { useEffect, useState } from 'react';
import { getScores, getReport } from '../../services/assessmentApi';
import ScoreCard from '../../components/ScoreCard/ScoreCard';
import Card from '../../components/Card/Card';
import Skeleton from '../../components/Skeleton/Skeleton';
import EmptyState from '../../components/EmptyState/EmptyState';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import styles from './ResultsPage.module.css';

function LoadingGrid() {
  return (
    <div className={styles.grid} aria-busy="true">
      <span className="sr-only" role="status">
        Loading your results…
      </span>
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i}>
          <Skeleton height={18} width="70%" className={styles.skeletonGap} />
          <Skeleton height={36} width="40%" className={styles.skeletonGap} />
          <Skeleton height={28} />
        </Card>
      ))}
    </div>
  );
}

export default function ResultsPage({ attemptId, reportId }) {
  const [scores, setScores] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [scoresRes, reportRes] = await Promise.all([getScores(attemptId), getReport(reportId)]);
        setScores(scoresRes.scores);
        setReport(reportRes);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [attemptId, reportId]);

  if (error) return <StatusMessage type="error" message={error} />;
  if (!scores || !report) return <LoadingGrid />;

  if (report.releasedSections.length === 0) {
    return <EmptyState message="No report yet" />;
  }

  // A held/quality-hold/ineligible attempt surfaces exactly one neutral section.
  const isNeutral = report.releasedSections.length === 1 && report.releasedSections[0].sectionType === 'T11_HOLD_NEUTRAL';
  if (isNeutral) {
    return (
      <Card className={styles.neutralCard}>
        <StatusMessage type="neutral" message={report.releasedSections[0].content.title} />
        <p className={styles.neutralBody}>{report.releasedSections[0].content.body}</p>
      </Card>
    );
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Your results</h2>
      <div className={styles.grid}>
        {report.releasedSections.map((section) => (
          <ScoreCard
            key={`${section.sectionType}-${section.domainCode}`}
            domainName={section.content.domainName || section.content.title}
            rawScore={section.content.rawScore}
            completenessRate={section.content.completenessRate}
            scoreStatus={section.content.scoreStatus}
            body={section.content.body}
          />
        ))}
      </div>
    </div>
  );
}

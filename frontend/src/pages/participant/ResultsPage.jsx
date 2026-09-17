import { useEffect, useState } from 'react';
import { getScores, getReport } from '../../services/assessmentApi';

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

  if (error) return <p className="error-text">{error}</p>;
  if (!scores || !report) return <p>Loading your results…</p>;

  // A held/quality-hold/ineligible attempt surfaces exactly one neutral section.
  const isNeutral = report.releasedSections.length === 1 && report.releasedSections[0].sectionType === 'T11_HOLD_NEUTRAL';
  if (isNeutral) {
    return (
      <div className="page">
        <h2>{report.releasedSections[0].content.title}</h2>
        <p>{report.releasedSections[0].content.body}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Your results</h2>
      {report.releasedSections.map((section) => (
        <section key={`${section.sectionType}-${section.domainCode}`} className="domain-section">
          <h3>{section.content.title}</h3>
          <p>{section.content.body}</p>
          {section.content.rawScore != null && (
            <p className="progress-line">
              Score: {section.content.rawScore.toFixed(2)} / 5.00 · Completeness: {Math.round(section.content.completenessRate * 100)}%
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

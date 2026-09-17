import { useEffect, useState } from 'react';
import { getSubmissions, getSubmissionDetail, reviewQualityFlag } from '../../services/assessmentApi';

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

  if (error) return <p className="error-text">{error}</p>;
  if (!detail) return <p>Loading…</p>;

  return (
    <div>
      <button type="button" onClick={onBack}>
        ← Back to submissions
      </button>
      <h3>{detail.attempt.santulanId} — {detail.attempt.versionLabel}</h3>
      <p>Status: {detail.attempt.status} · Session {detail.attempt.sessionCount} of 4</p>

      <h4>Scores</h4>
      <ul>
        {detail.scores.map((s) => (
          <li key={s.domainCode}>
            {s.domainCode}: {s.rawScore.toFixed(2)} ({s.scoreStatus}), completeness {Math.round(s.completenessRate * 100)}%
          </li>
        ))}
      </ul>

      <h4>Quality flags</h4>
      {detail.qualityFlags.length === 0 && <p>None</p>}
      <ul>
        {detail.qualityFlags.map((f) => (
          <li key={f.id}>
            {f.flagCode} ({f.severity}) — {f.disposition || 'not reviewed'}{' '}
            <button type="button" onClick={() => disposition(f.id)}>
              Review
            </button>
          </li>
        ))}
      </ul>
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

  if (error) return <p className="error-text">{error}</p>;
  if (selected) return <SubmissionDetail attemptId={selected} onBack={() => setSelected(null)} />;
  if (!submissions) return <p>Loading…</p>;

  return (
    <div className="page">
      <h2>Submissions</h2>
      <table>
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
              <td>{s.qualityFlagCount}</td>
              <td>
                <button type="button" onClick={() => setSelected(s.attemptId)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

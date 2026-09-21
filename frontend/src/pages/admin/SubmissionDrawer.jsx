import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/santulanApi';
import Modal from '../../components/Modal/Modal';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { DOMAIN_NAMES, formatDateTime } from './adminMetrics';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const COMPLETENESS = { COMPLETE: 'Complete', COMPLETE_WITH_MISSING: 'Complete, some skipped', INCOMPLETE: 'Incomplete', INSUFFICIENT: 'Not enough answers' };
const DISPOSITION = { UNREVIEWED: 'Not reviewed', DISMISSED: 'Dismissed', CONFIRMED: 'Confirmed', ESCALATED: 'Escalated' };

/**
 * Side drawer with one submission: its domain results (evidence state and completeness status; research data, not participant feedback),
 * its quality flags with their review disposition, and its report state. Flags are reviewed on the Quality review page.
 */
export default function SubmissionDrawer({ submission, onClose }) {
  const [state, setState] = useState({ status: 'loading', detail: null, error: null });
  useEffect(() => {
    let cancelled = false;
    adminApi.submission(submission.attemptId)
      .then((detail) => { if (!cancelled) setState({ status: 'ready', detail, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', detail: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [submission.attemptId]);

  const d = state.detail;
  return (
    <Modal open onClose={onClose} side title={`Submission ${submission.santulanId || ''}`} description={submission.versionLabel ? `${submission.versionLabel} (revision ${submission.revision})` : undefined}>
      {state.status === 'loading' && <div aria-busy="true"><Skeleton height={140} /></div>}
      {state.status === 'error' && <StatusMessage type="error" message={state.error} />}
      {d && (
        <div className={styles.stack}>
          <dl className={styles.dl}>
            <dt>Status</dt><dd><StatusPill status={d.status} /></dd>
            <dt>Sessions</dt><dd>{d.sessionCount} of 4</dd>
            <dt>Submitted</dt><dd>{formatDateTime(d.submittedAt)}</dd>
            <dt>Scoring version</dt><dd>{d.scoringVersion || '—'}</dd>
            <dt>Report</dt><dd>{d.report ? `${d.report.state.replace(/_/g, ' ').toLowerCase()}${d.report.retryCount ? ` (retried ${d.report.retryCount}×)` : ''}` : 'Not started'}</dd>
          </dl>

          <section aria-labelledby="sub-domains">
            <h3 id="sub-domains" className={styles.itemHead}>Domain results</h3>
            {d.domainResults.length === 0 ? <EmptyState message="Not scored yet." /> : (
              <div className={tableStyles.scroll}>
                <table className={tableStyles.table}>
                  <caption className="sr-only">Domain results</caption>
                  <thead>
                    <tr><th scope="col">Domain</th><th scope="col" className={tableStyles.num}>Score</th><th scope="col">Completeness</th><th scope="col">Evidence</th></tr>
                  </thead>
                  <tbody>
                    {d.domainResults.map((r) => (
                      <tr key={r.domainCode}>
                        <td>{r.domainCode} {DOMAIN_NAMES[r.domainCode]}</td>
                        <td className={tableStyles.num}>{r.score == null ? '—' : r.score.toFixed(2)}</td>
                        <td>{Math.round(r.completeness * 100)}% ({r.validItems} of {r.eligibleItems}) · {COMPLETENESS[r.completenessStatus] || r.completenessStatus}</td>
                        <td>{r.evidenceState}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="sub-flags">
            <h3 id="sub-flags" className={styles.itemHead}>Quality flags</h3>
            {d.flags.length === 0 ? <p className={styles.muted}>No quality flags.</p> : (
              <ul className={styles.gateList}>
                {d.flags.map((f) => <li key={f.flagId}>{f.flagCode}{f.domainCode ? ` · ${f.domainCode}` : ''} · {DISPOSITION[f.disposition] || f.disposition}</li>)}
              </ul>
            )}
            <Link to="/admin/quality-review" className={styles.linkButton} onClick={onClose}>Open the review queue</Link>
          </section>
        </div>
      )}
    </Modal>
  );
}

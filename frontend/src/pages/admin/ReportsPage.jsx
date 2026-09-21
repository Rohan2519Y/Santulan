import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { useToast } from '../../components/Toast/Toast';
import { adminApi } from '../../services/santulanApi';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

/** Reports: the retry queue. A failed report is retried on purpose (audited); a retry never retakes the assessment and never rescores. */
export default function ReportsPage() {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const list = useAdminData(() => adminApi.submissions({ reportState: 'FAILED_RETRYABLE' }), []);

  const retry = async (s) => {
    setBusyId(s.report.reportId);
    try {
      const res = await adminApi.retryReport(s.report.reportId);
      toast.push({ type: res.state === 'REPORT_READY' ? 'success' : 'warning', message: res.state === 'REPORT_READY' ? `Report for ${s.santulanId} is ready.` : `Report for ${s.santulanId} could not be built yet; it stays in the queue.` });
      await list.reload();
    } catch (err) { toast.push({ type: 'error', message: `Could not retry: ${err.message}` }); } finally { setBusyId(null); }
  };

  return (
    <>
      <PageHeader title="Reports" description="Reports that could not be built yet. Retrying is recorded in the audit log. Common reason: approved report wording has not been loaded for the question set." />
      <div className={styles.stack}>
        <Panel title="Retry queue" flush>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={120} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.submissions.length === 0 ? (
            <EmptyState message="No reports are waiting for a retry." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Reports waiting for a retry</caption>
                <thead>
                  <tr><th scope="col">Santulan ID</th><th scope="col">Question set</th><th scope="col">Submitted</th><th scope="col" className={tableStyles.num}>Retries so far</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {list.data.submissions.map((s) => (
                    <tr key={s.attemptId}>
                      <td className={tableStyles.mono}>{s.santulanId}</td>
                      <td>{s.versionLabel} r{s.revision}</td>
                      <td>{formatDate(s.submittedAt)}</td>
                      <td className={tableStyles.num}>{s.report.retryCount}</td>
                      <td><Button type="button" variant="secondary" onClick={() => retry(s)} disabled={busyId === s.report.reportId} aria-label={`Retry the report for ${s.santulanId}`}>{busyId === s.report.reportId ? 'Working…' : 'Retry'}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { adminApi } from '../../services/santulanApi';
import SubmissionDrawer from './SubmissionDrawer';
import { STATUS_META, formatDateTime } from './adminMetrics';
import useAdminData from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

/** Submissions: attempts by Santulan ID with institution / cohort / status filters and a detail drawer. There is no client-side data download here - research data leaves only through the governed export. */
export default function SubmissionsPage() {
  const [filters, setFilters] = useState({ search: '', status: '', institutionId: '', cohortId: '' });
  const [applied, setApplied] = useState({});
  const [selected, setSelected] = useState(null);
  const list = useAdminData(() => adminApi.submissions(applied), [applied]);
  const institutions = useAdminData(() => adminApi.institutions(), []);
  const change = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value, ...(key === 'institutionId' ? { cohortId: '' } : {}) }));
  const chosen = institutions.data && institutions.data.institutions.find((i) => i.institutionId === filters.institutionId);

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Attempts by Santulan ID. Open a row for its domain results, quality flags and report state."
        actions={<Button type="button" variant="secondary" onClick={list.reload}><RefreshCw size={16} aria-hidden="true" />Refresh</Button>}
      />
      <div className={styles.stack}>
        <Panel title="Filters">
          <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setApplied(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); }}>
            <label className={styles.filterField}>
              Santulan ID
              <input type="search" value={filters.search} onChange={change('search')} placeholder="STN-…" autoComplete="off" spellCheck="false" />
            </label>
            <label className={styles.filterField}>
              Status
              <select value={filters.status} onChange={change('status')}>
                <option value="">Any</option>
                {STATUS_META.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              Institution
              <select value={filters.institutionId} onChange={change('institutionId')}>
                <option value="">Any</option>
                {(institutions.data ? institutions.data.institutions : []).map((i) => <option key={i.institutionId} value={i.institutionId}>{i.institutionName}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              Cohort
              <select value={filters.cohortId} onChange={change('cohortId')} disabled={!filters.institutionId}>
                <option value="">Any</option>
                {(chosen ? chosen.cohorts : []).map((c) => <option key={c.cohortId} value={c.cohortId}>{c.cohortName}</option>)}
              </select>
            </label>
            <Button type="submit" variant="primary">Apply filters</Button>
          </form>
        </Panel>

        <Panel title="Submissions" flush>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={160} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.submissions.length === 0 ? (
            <EmptyState message="No submissions match these filters." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Submissions</caption>
                <thead>
                  <tr>
                    <th scope="col">Santulan ID</th>
                    <th scope="col">Question set</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={tableStyles.num}>Sessions</th>
                    <th scope="col" className={tableStyles.num}>Flags</th>
                    <th scope="col">Submitted</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.submissions.map((s) => (
                    <tr key={s.attemptId}>
                      <td className={tableStyles.mono}>{s.santulanId}</td>
                      <td>{s.versionLabel} r{s.revision}</td>
                      <td><StatusPill status={s.status} /></td>
                      <td className={tableStyles.num}>{s.sessionCount} of 4</td>
                      <td className={tableStyles.num}>{s.qualityFlagCount > 0 ? <span className={tableStyles.flagChip}>{s.qualityFlagCount}</span> : <span className={tableStyles.flagZero}>0</span>}</td>
                      <td>{formatDateTime(s.submittedAt)}</td>
                      <td><button type="button" className={tableStyles.rowAction} onClick={() => setSelected(s)} aria-label={`View submission ${s.santulanId}`}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Panel>
      </div>
      {selected && <SubmissionDrawer submission={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

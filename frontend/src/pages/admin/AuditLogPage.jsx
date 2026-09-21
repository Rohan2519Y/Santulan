import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { adminApi } from '../../services/santulanApi';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const summary = (state) => (state ? Object.entries(state).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '—');

/** Audit log: read-only, newest first. Nothing on this page can change a record. */
export default function AuditLogPage() {
  const [form, setForm] = useState({ action: '', targetEntity: '', from: '', to: '' });
  const [applied, setApplied] = useState({});
  const list = useAdminData(() => adminApi.auditLogs(applied), [applied]);
  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Audit log" description="Every privileged change and every download, with who did it, what changed and why. Read-only." />
      <div className={styles.stack}>
        <Panel title="Filters">
          <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setApplied(Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))); }}>
            <label className={styles.filterField}>Action<input value={form.action} onChange={change('action')} placeholder="e.g. PARTICIPATION_CONTROL" /></label>
            <label className={styles.filterField}>Record type<input value={form.targetEntity} onChange={change('targetEntity')} placeholder="e.g. participants" /></label>
            <label className={styles.filterField}>From<input value={form.from} onChange={change('from')} placeholder="YYYY-MM-DD" inputMode="numeric" /></label>
            <label className={styles.filterField}>To<input value={form.to} onChange={change('to')} placeholder="YYYY-MM-DD" inputMode="numeric" /></label>
            <Button type="submit" variant="primary">Apply filters</Button>
          </form>
        </Panel>

        <Panel title="Entries" flush>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={160} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.auditLogs.length === 0 ? (
            <EmptyState message="No entries match these filters." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Audit log entries, newest first</caption>
                <thead>
                  <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Reason</th></tr>
                </thead>
                <tbody>
                  {list.data.auditLogs.map((r) => (
                    <tr key={r.auditId}>
                      <td>{formatDate(r.occurredAt)}</td>
                      <td>{r.actorType === 'ADMIN' ? 'Administrator' : r.actorType === 'SYSTEM' ? 'System' : 'Participant'}</td>
                      <td className={tableStyles.mono}>{r.actionType}</td>
                      <td>{r.targetEntity}</td>
                      <td>{summary(r.previousState)}</td>
                      <td>{summary(r.newState)}</td>
                      <td>{r.reason || '—'}</td>
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

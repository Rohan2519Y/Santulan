import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { useToast } from '../../components/Toast/Toast';
import { adminApi } from '../../services/santulanApi';
import ReasonDialog from './ReasonDialog';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const TONE = { ACTIVE: 'success', SUSPENDED: 'warning', WITHDRAWN: 'neutral' };
const label = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/** Participants: filtered list (opaque Santulan ID only), suspend / reactivate with a required reason, temporary-credential reset. */
export default function ParticipantsPage() {
  const toast = useToast();
  const [filters, setFilters] = useState({ search: '', route: '', status: '', institutionId: '', cohortId: '' });
  const [applied, setApplied] = useState({});
  const [dialog, setDialog] = useState(null); // { participant, next }
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const [temp, setTemp] = useState(null); // the one-time temporary credential shown after a reset
  const list = useAdminData(() => adminApi.participants(applied), [applied]);
  const institutions = useAdminData(() => adminApi.institutions(), []);

  const change = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value, ...(key === 'institutionId' ? { cohortId: '' } : {}) }));
  const chosen = institutions.data && institutions.data.institutions.find((i) => i.institutionId === filters.institutionId);
  const cohorts = chosen ? chosen.cohorts : [];

  /** Resolves a participant's institution/cohort names from the already-loaded institutions list (same data the filters use),
   * so the table shows who a participant actually belongs to instead of just an opaque id. */
  const orgOf = (p) => {
    if (p.participationRoute !== 'INSTITUTIONAL' || !institutions.data) return null;
    const inst = institutions.data.institutions.find((i) => i.institutionId === p.institutionId);
    if (!inst) return null;
    const cohort = inst.cohorts.find((c) => c.cohortId === p.cohortId);
    return { institutionName: inst.institutionName, cohortName: cohort ? cohort.cohortName : null };
  };

  const confirm = async (reason) => {
    setWorking(true);
    setProblem(null);
    try {
      await adminApi.setParticipantStatus(dialog.participant.participantId, dialog.next, reason);
      toast.push({ type: 'success', message: `${dialog.participant.santulanId} is now ${dialog.next.toLowerCase()}.` });
      setDialog(null);
      await list.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };

  const reset = async (p) => {
    try {
      const res = await adminApi.resetCredential(p.participantId);
      setTemp({ santulanId: p.santulanId, value: res.temporaryPassword });
    } catch (err) { toast.push({ type: 'error', message: `Could not reset the credential: ${err.message}` }); }
  };

  return (
    <>
      <PageHeader title="Participants" description="Participants appear by their Santulan ID only. Suspending or reactivating needs a reason and is recorded in the audit log." />
      <div className={styles.stack}>
        <Panel title="Filters">
          <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setApplied(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))); }}>
            <label className={styles.filterField}>
              Santulan ID
              <input type="search" value={filters.search} onChange={change('search')} placeholder="STN-…" autoComplete="off" spellCheck="false" />
            </label>
            <label className={styles.filterField}>
              Route
              <select value={filters.route} onChange={change('route')}>
                <option value="">Any</option>
                <option value="OPEN">Open</option>
                <option value="INSTITUTIONAL">Institutional</option>
              </select>
            </label>
            <label className={styles.filterField}>
              Status
              <select value={filters.status} onChange={change('status')}>
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="WITHDRAWN">Withdrawn</option>
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
                {cohorts.map((c) => <option key={c.cohortId} value={c.cohortId}>{c.cohortName}</option>)}
              </select>
            </label>
            <Button type="submit" variant="primary">Apply filters</Button>
          </form>
          <p className={styles.muted}>With no filter the list covers every participant. A partial Santulan ID matches from the start of the id, with or without the STN- prefix.</p>
        </Panel>

        {temp && (
          <StatusMessage type="warning" message={`Temporary credential for ${temp.santulanId}: ${temp.value}. It is shown once; the previous credential no longer works.`} />
        )}

        <Panel title="Participants" flush>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={160} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.participants.length === 0 ? (
            <EmptyState message="No participants match these filters." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Participants</caption>
                <thead>
                  <tr>
                    <th scope="col">Santulan ID</th>
                    <th scope="col">Route</th>
                    <th scope="col">Institution / Cohort</th>
                    <th scope="col">Track</th>
                    <th scope="col">Status</th>
                    <th scope="col">Registered</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.participants.map((p) => {
                    const org = orgOf(p);
                    return (
                    <tr key={p.participantId}>
                      <td className={tableStyles.mono}>{p.santulanId}</td>
                      <td>{p.participationRoute === 'OPEN' ? 'Open' : 'Institutional'}</td>
                      <td>
                        {org ? (
                          <span className={styles.orgCell}>
                            <span className={styles.orgInstitution}>{org.institutionName}</span>
                            {org.cohortName && (
                              <span className={styles.cohortRowInline}>
                                <span className={styles.cohortTag}>Cohort</span>
                                <span className={styles.cohortName}>{org.cohortName}</span>
                              </span>
                            )}
                          </span>
                        ) : <span className={styles.muted}>&mdash;</span>}
                      </td>
                      <td>{p.assessmentTrack === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'}</td>
                      <td><StatusPill tone={TONE[p.status] || 'neutral'} label={label(p.status)} /></td>
                      <td>{formatDate(p.createdAt)}</td>
                      <td>
                        <span className={styles.rowActions}>
                          {p.status === 'ACTIVE' && <Button type="button" variant="secondary" onClick={() => { setProblem(null); setDialog({ participant: p, next: 'SUSPENDED' }); }} aria-label={`Suspend ${p.santulanId}`}>Suspend</Button>}
                          {p.status === 'SUSPENDED' && <Button type="button" variant="secondary" onClick={() => { setProblem(null); setDialog({ participant: p, next: 'ACTIVE' }); }} aria-label={`Reactivate ${p.santulanId}`}>Reactivate</Button>}
                          {p.participationRoute === 'INSTITUTIONAL' && p.status !== 'WITHDRAWN' && <Button type="button" variant="secondary" onClick={() => reset(p)} aria-label={`Reset credential for ${p.santulanId}`}>Reset credential</Button>}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.data.truncated && <p className={styles.muted}>Showing the newest {list.data.participants.length} of {list.data.total}. Use the filters to narrow the list.</p>}
            </div>
          ))}
        </Panel>
      </div>

      <ReasonDialog
        open={!!dialog}
        title={dialog ? `${dialog.next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} ${dialog.participant.santulanId}?` : ''}
        message={dialog && dialog.next === 'SUSPENDED' ? 'The participant is refused on their next request and cannot continue until reactivated.' : 'The participant can sign in and continue again.'}
        confirmLabel={dialog && dialog.next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
        tone={dialog && dialog.next === 'SUSPENDED' ? 'warning' : 'brand'}
        busy={working}
        problem={problem}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}

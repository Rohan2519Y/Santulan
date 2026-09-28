import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { useToast } from '../../components/Toast/Toast';
import { adminApi, questionSetApi, newKey } from '../../services/santulanApi';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const TONE = { REQUESTED: 'info', GENERATING: 'info', READY: 'success', FAILED: 'error' };
const LABEL = { REQUESTED: 'Requested', GENERATING: 'Preparing', READY: 'Ready', FAILED: 'Failed' };
const BLANK = { sourceAssessmentVersionId: '', anonymisationVersion: '', institutionId: '', cohortId: '', participantStatus: '', dateFrom: '', dateTo: '' };

/**
 * Research exports: request a workbook (source question set, anonymisation version, optional filters), watch its status
 * and download it only when it is Ready. Nine fixed sheets (README, PARTICIPANTS, ITEM_RESPONSES_LONG, QUALITY_REVIEW,
 * ATTEMPT_SUMMARY, one VALIDATION_WIDE_<track>, ITEM_CODEBOOK, RESEARCH_DASHBOARD) - always the current answer for
 * each question, with explicit missing rows. Files never leave through a path.
 */
export default function ExportsPage() {
  const toast = useToast();
  const list = useAdminData(() => adminApi.exports(), []);
  const sets = useAdminData(() => questionSetApi.list(), []);
  const institutions = useAdminData(() => adminApi.institutions(), []);
  const [form, setForm] = useState(BLANK);
  const [key, setKey] = useState(() => newKey('export')); // one key per logical request; a retry of the same form reuses it
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const busyRows = list.data ? list.data.exports.some((x) => x.status === 'REQUESTED' || x.status === 'GENERATING') : false;
  useEffect(() => {
    if (!busyRows) return undefined;
    const timer = setInterval(list.reload, 5000);
    return () => clearInterval(timer);
  }, [busyRows, list.reload]);

  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'institutionId' ? { cohortId: '' } : {}) }));
  const chosen = institutions.data && institutions.data.institutions.find((i) => i.institutionId === form.institutionId);

  const submit = async (e) => {
    e.preventDefault();
    setWorking(true);
    setProblem(null);
    const filters = Object.fromEntries(['institutionId', 'cohortId', 'participantStatus', 'dateFrom', 'dateTo'].filter((k) => form[k]).map((k) => [k, form[k]]));
    try {
      await adminApi.requestExport({ sourceAssessmentVersionId: form.sourceAssessmentVersionId, anonymisationVersion: form.anonymisationVersion.trim(), filters }, key);
      toast.push({ type: 'success', message: 'Export requested. It will appear below when it is ready.' });
      setKey(newKey('export'));
      await list.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };

  const download = async (x) => {
    try { await adminApi.downloadExport(x.exportId); toast.push({ type: 'success', message: 'Download started. It is recorded in the audit log.' }); } catch (err) { toast.push({ type: 'error', message: `Could not download: ${err.message}` }); }
  };

  const setOptions = sets.data ? sets.data.sets.filter((s) => s.status !== 'DRAFT') : [];
  const describe = (x) => {
    const f = Object.entries(x.filters || {}).filter(([, v]) => v);
    return f.length ? f.map(([k, v]) => `${k}: ${v}`).join(', ') : 'none';
  };

  return (
    <>
      <PageHeader title="Research exports" description="A workbook of research data without names, contact details or login identifiers. Participants appear only by a pseudonymous research id, decoupled from their sign-in Santulan ID; withdrawn participants are excluded." />
      <div className={styles.stack}>
        <Panel title="Request an export">
          <form className={styles.dialogForm} onSubmit={submit}>
            <div className={styles.filters}>
              <label className={styles.filterField}>
                Question set
                <select value={form.sourceAssessmentVersionId} onChange={change('sourceAssessmentVersionId')} required>
                  <option value="">Choose…</option>
                  {setOptions.map((s) => <option key={s.setId} value={s.setId}>{s.versionLabel} r{s.revision}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Anonymisation version
                <input value={form.anonymisationVersion} onChange={change('anonymisationVersion')} required maxLength={64} />
              </label>
            </div>
            <div className={styles.filters}>
              <label className={styles.filterField}>
                Institution (optional)
                <select value={form.institutionId} onChange={change('institutionId')}>
                  <option value="">Any</option>
                  {(institutions.data ? institutions.data.institutions : []).map((i) => <option key={i.institutionId} value={i.institutionId}>{i.institutionName}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Cohort (optional)
                <select value={form.cohortId} onChange={change('cohortId')} disabled={!form.institutionId}>
                  <option value="">Any</option>
                  {(chosen ? chosen.cohorts : []).map((c) => <option key={c.cohortId} value={c.cohortId}>{c.cohortName}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                From (optional)
                <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={form.dateFrom} onChange={change('dateFrom')} />
              </label>
              <label className={styles.filterField}>
                To (optional)
                <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={form.dateTo} onChange={change('dateTo')} />
              </label>
            </div>
            {problem && <StatusMessage type="error" message={problem} />}
            <div className={styles.rowActions}>
              <Button type="submit" variant="primary" disabled={working || !form.sourceAssessmentVersionId || !form.anonymisationVersion.trim()}>{working ? 'Working…' : 'Request export'}</Button>
            </div>
          </form>
        </Panel>

        <Panel title="Exports" flush>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={120} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.exports.length === 0 ? (
            <EmptyState message="No exports yet." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Research exports</caption>
                <thead>
                  <tr><th scope="col">Requested</th><th scope="col">Status</th><th scope="col">Filters</th><th scope="col">Anonymisation</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {list.data.exports.map((x) => (
                    <tr key={x.exportId}>
                      <td>{formatDate(x.createdAt)}</td>
                      <td><StatusPill tone={TONE[x.status]} label={LABEL[x.status] || x.status} /></td>
                      <td>{describe(x)}</td>
                      <td>{x.anonymisationVersion}</td>
                      <td>{x.status === 'READY' && <Button type="button" variant="secondary" onClick={() => download(x)} aria-label={`Download the export requested ${formatDate(x.createdAt)}`}>Download</Button>}</td>
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

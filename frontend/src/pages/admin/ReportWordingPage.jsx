import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import StatusPill from '../../components/StatusPill/StatusPill';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { useToast } from '../../components/Toast/Toast';
import { questionSetApi, wordingApi } from '../../services/santulanApi';
import { DOMAIN_NAMES } from '../participant/AssessmentPage';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const BANDS = ['D1', 'D2', 'D3', 'D4'];
const STATES = ['S2', 'S3', 'S4', 'S5'];
const LAYER_LABEL = { MEANING: 'What this area is about', PATTERN: 'Your pattern', STRENGTH: 'A strength', GROWTH: 'Something to grow', CHANGE: 'Since your last time', PRIORITY: 'A priority to consider', ACTION: 'Small actions to try' };
const LAYERS = Object.keys(LAYER_LABEL);
const STATUS_TONE = { DRAFT: 'neutral', APPROVED: 'success', RETIRED: 'neutral' };

const emptyForm = { domain: 'C1', band: '', evidenceState: 'S2', locale: 'en', layer: 'MEANING', version: '', text: '' };

/**
 * Report wording (interpretation_rules): the admin UI path alongside the existing CLI script (scripts/wording-load.js).
 * The engine never writes prose - every row here is text a human wrote and, once Approved, is the ONLY thing the report
 * renderer is allowed to show for that exact domain/band/evidence-state/layer. Adding a rule never shows it to anyone;
 * only Approve does, and that is audited.
 */
export default function ReportWordingPage() {
  const toast = useToast();
  const [setId, setSetId] = useState('');
  const sets = useAdminData(() => questionSetApi.list(), []);
  const rules = useAdminData(() => (setId ? wordingApi.list(setId) : Promise.resolve(null)), [setId]);

  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  const [approving, setApproving] = useState(null); // the rule being approved
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [approveError, setApproveError] = useState(null);

  const setOptions = sets.data ? sets.data.sets.filter((s) => s.status !== 'DRAFT') : [];

  const submitAdd = async (e) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await wordingApi.add({ assessmentVersionId: setId, ...form, band: form.band || null, text: form.text.trim() });
      toast.push({ type: 'success', message: 'Wording added as Draft. Approve it to let the report use it.' });
      setForm({ ...emptyForm, domain: form.domain, layer: form.layer, evidenceState: form.evidenceState });
      await rules.reload();
    } catch (err) { setAddError(err.message); } finally { setAdding(false); }
  };

  const closeApprove = () => { setApproving(null); setReason(''); setApproveError(null); };
  const confirmApprove = async () => {
    setWorking(true);
    setApproveError(null);
    try {
      await wordingApi.approve(approving.ruleId, reason.trim());
      toast.push({ type: 'success', message: `${approving.ruleCode} v${approving.version} is now Approved.` });
      closeApprove();
      await rules.reload();
    } catch (err) { setApproveError(err.message); } finally { setWorking(false); }
  };

  return (
    <>
      <PageHeader
        title="Report wording"
        description="The text a report is allowed to show, per domain and layer. The engine never writes this itself - a rule has to be added and then separately Approved before any participant's report can use it."
      />
      <div className={styles.stack}>
        <Panel title="Choose an assessment">
          {sets.status === 'error' && <StatusMessage type="error" message={sets.error} />}
          <div className={styles.filters}>
            <label className={styles.filterField}>
              Assessment
              <select value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">Choose…</option>
                {setOptions.map((s) => (
                  <option key={s.setId} value={s.setId}>
                    {s.versionLabel} r{s.revision} · {s.ageGroup === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Panel>

        {!setId && <EmptyState message="Choose an assessment above to see and add its report wording." />}

        {setId && (
          <Panel title="Add wording">
            <form className={styles.filters} onSubmit={submitAdd} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className={styles.filterField}>
                Domain
                <select value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}>
                  {Object.entries(DOMAIN_NAMES).map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Developmental band
                <select value={form.band} onChange={(e) => setForm({ ...form, band: e.target.value })}>
                  <option value="">All bands</option>
                  {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Evidence state
                <select value={form.evidenceState} onChange={(e) => setForm({ ...form, evidenceState: e.target.value })}>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Layer
                <select value={form.layer} onChange={(e) => setForm({ ...form, layer: e.target.value })}>
                  {LAYERS.map((l) => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}
                </select>
              </label>
              <label className={styles.filterField}>
                Locale
                <input type="text" value={form.locale} maxLength={16} onChange={(e) => setForm({ ...form, locale: e.target.value })} required />
              </label>
              <label className={styles.filterField}>
                Version
                <input type="text" value={form.version} maxLength={32} placeholder="e.g. v1" onChange={(e) => setForm({ ...form, version: e.target.value })} required />
              </label>
              <label className={styles.filterField} style={{ flexBasis: '100%' }}>
                Text
                <textarea rows={3} maxLength={4000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required />
              </label>
              {addError && <StatusMessage type="error" message={addError} />}
              <Button type="submit" variant="primary" disabled={adding || !form.version.trim() || !form.text.trim()}>{adding ? 'Adding…' : 'Add as Draft'}</Button>
            </form>
          </Panel>
        )}

        {setId && rules.status === 'loading' && <Panel><div aria-busy="true"><Skeleton height={160} /></div></Panel>}
        {setId && rules.status === 'error' && <StatusMessage type="error" message={rules.error} />}
        {setId && rules.status === 'ready' && rules.data && (
          <Panel title={`${rules.data.set.versionLabel} · revision ${rules.data.set.revision}`} subtitle={`${rules.data.rules.length} wording rule${rules.data.rules.length === 1 ? '' : 's'}`}>
            {rules.data.rules.length === 0 ? (
              <EmptyState message="No wording has been added for this assessment yet." />
            ) : (
              <div className={tableStyles.scroll}>
                <table className={tableStyles.table}>
                  <caption className="sr-only">Report wording rules</caption>
                  <thead>
                    <tr>
                      <th scope="col">Domain</th>
                      <th scope="col">Band</th>
                      <th scope="col">Evidence</th>
                      <th scope="col">Layer</th>
                      <th scope="col">Version</th>
                      <th scope="col">Text</th>
                      <th scope="col">Status</th>
                      <th scope="col">Added</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.data.rules.map((r) => (
                      <tr key={r.ruleId}>
                        <td>{r.domainCode}</td>
                        <td>{r.band || 'All'}</td>
                        <td>{r.evidenceState}</td>
                        <td>{LAYER_LABEL[r.layer] || r.layer}</td>
                        <td className={tableStyles.mono}>{r.version}</td>
                        <td>{r.text.length > 80 ? `${r.text.slice(0, 80)}…` : r.text}</td>
                        <td><StatusPill tone={STATUS_TONE[r.status] || 'neutral'} label={r.status === 'DRAFT' ? 'Draft' : r.status === 'APPROVED' ? 'Approved' : 'Retired'} /></td>
                        <td>{formatDate(r.createdAt)}</td>
                        <td>
                          {r.status === 'DRAFT' && (
                            <button type="button" className={tableStyles.rowAction} onClick={() => { setApproveError(null); setApproving(r); }} aria-label={`Approve ${r.ruleCode} v${r.version}`}>
                              Approve
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>

      {approving && (
        <ConfirmDialog
          open
          title="Approve this wording"
          message={`${approving.ruleCode} v${approving.version} will become the text the report shows for this domain, band and layer. This cannot be undone from here - approving a different version later needs this one retired first.`}
          confirmLabel="Approve"
          busy={working}
          confirmDisabled={reason.trim().length < 3}
          onConfirm={confirmApprove}
          onCancel={closeApprove}
        >
          <label className={styles.reasonLabel} htmlFor="wording-approve-reason">Reason (required, 3 to 300 characters)</label>
          <textarea id="wording-approve-reason" className={styles.reasonBox} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          {approveError && <StatusMessage type="error" message={approveError} />}
        </ConfirmDialog>
      )}
    </>
  );
}

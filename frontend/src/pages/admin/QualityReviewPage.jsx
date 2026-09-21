import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import Modal from '../../components/Modal/Modal';
import { useToast } from '../../components/Toast/Toast';
import { adminApi } from '../../services/santulanApi';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const DISPOSITION = { UNREVIEWED: 'Not reviewed', DISMISSED: 'Dismissed', CONFIRMED: 'Confirmed', ESCALATED: 'Escalated' };
const CHOICES = [['DISMISSED', 'Dismiss (no concern)'], ['CONFIRMED', 'Confirm'], ['ESCALATED', 'Escalate to the responsible person']];

/** Quality review: the restricted queue of quality flags and the disposition decision. Safeguarding-related detail appears only on this page. */
export default function QualityReviewPage() {
  const toast = useToast();
  const [disposition, setDisposition] = useState('UNREVIEWED');
  const list = useAdminData(() => adminApi.qualityFlags(disposition ? { disposition } : {}), [disposition]);
  const [reviewing, setReviewing] = useState(null);
  const [choice, setChoice] = useState('DISMISSED');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const close = () => { setReviewing(null); setNote(''); setChoice('DISMISSED'); setProblem(null); };
  const save = async (e) => {
    e.preventDefault();
    setWorking(true);
    setProblem(null);
    try {
      await adminApi.reviewFlag(reviewing.flagId, choice, note.trim());
      toast.push({ type: 'success', message: 'Review saved and recorded in the audit log.' });
      close();
      await list.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };

  return (
    <>
      <PageHeader title="Quality review" description="Flags raised on attempts, for the people responsible for reviewing them. Handle this page with the same care as the underlying data." />
      <div className={styles.stack}>
        <Panel title="Queue">
          <div className={styles.filters}>
            <label className={styles.filterField}>
              Show
              <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                <option value="UNREVIEWED">Not reviewed</option>
                <option value="">All flags</option>
                <option value="DISMISSED">Dismissed</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="ESCALATED">Escalated</option>
              </select>
            </label>
          </div>
          {list.status === 'loading' && <div aria-busy="true"><Skeleton height={140} /></div>}
          {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
          {list.status === 'ready' && (list.data.flags.length === 0 ? (
            <EmptyState message="Nothing to review here." />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Quality flags</caption>
                <thead>
                  <tr>
                    <th scope="col">Santulan ID</th>
                    <th scope="col">Flag</th>
                    <th scope="col">Domain</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Detected</th>
                    <th scope="col">Disposition</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.flags.map((f) => (
                    <tr key={f.flagId}>
                      <td className={tableStyles.mono}>{f.santulanId}</td>
                      <td>{f.flagCode}</td>
                      <td>{f.domainCode || '—'}</td>
                      <td>{f.severity}</td>
                      <td>{formatDate(f.detectedAt)}</td>
                      <td>{DISPOSITION[f.disposition] || f.disposition}</td>
                      <td><button type="button" className={tableStyles.rowAction} onClick={() => { setProblem(null); setReviewing(f); }} aria-label={`Review ${f.flagCode} for ${f.santulanId}`}>Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Panel>
      </div>

      <Modal open={!!reviewing} onClose={close} title="Review this flag" description={reviewing ? `${reviewing.flagCode} on ${reviewing.santulanId}` : undefined}>
        <form className={styles.dialogForm} onSubmit={save}>
          <fieldset className={styles.filterField}>
            <legend>Decision</legend>
            {CHOICES.map(([v, l]) => (
              <label key={v}><input type="radio" name="decision" value={v} checked={choice === v} onChange={() => setChoice(v)} /> {l}</label>
            ))}
          </fieldset>
          <div>
            <label className={styles.reasonLabel} htmlFor="review-note">Note (optional)</label>
            <textarea id="review-note" className={styles.reasonBox} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem && <StatusMessage type="error" message={problem} />}
          <div className={styles.rowActions}>
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={working}>{working ? 'Working…' : 'Save review'}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

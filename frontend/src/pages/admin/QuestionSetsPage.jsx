import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { questionSetApi } from '../../services/santulanApi';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import FileDropzone from '../../components/FileDropzone/FileDropzone';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import StatusPill from '../../components/StatusPill/StatusPill';
import EmptyState from '../../components/EmptyState/EmptyState';
import Button from '../../components/Button/Button';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { useToast } from '../../components/Toast/Toast';
import tableStyles from './adminTable.module.css';
import pageStyles from './adminPages.module.css';
import styles from './questionSets.module.css';

const MAX_BYTES = 2 * 1024 * 1024;
const AGE_GROUPS = [
  { value: 'ADOLESCENT', label: 'Adolescent (13–17)' },
  { value: 'EMERGING_ADULT', label: 'Emerging adult (18–25)' },
];
const STATUS_TONE = { DRAFT: 'neutral', FROZEN: 'info', RETIRED: 'neutral' };
const ACTION_COPY = {
  open: { title: 'Open for participation', confirm: 'Open', message: 'Participants of this age group will be given this question set. Only one set can be open per age group.' },
  close: { title: 'Close participation', confirm: 'Close', message: 'New attempts will be refused. Attempts already started keep their answers and this set.' },
};
/* Delete reaches DRAFT sets only (CR-006-12): a draft was never frozen, so nothing can already depend on it. Once frozen, a
 * set is permanent - Delete is never offered for one, and the server refuses it (SET_NOT_DRAFT) even if it were tried. */

/** Friendly text for a few well-known upload codes; anything else shows the server's message as is. */
const hint = (code) => (code === 'OLD_FORMAT_NOT_SUPPORTED' ? 'Use the template: it has the option columns the new format needs.' : null);

export default function QuestionSetsPage() {
  const toast = useToast();
  const [ageGroup, setAgeGroup] = useState('ADOLESCENT');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rejected, setRejected] = useState(null); // { message, total, problems: [] }
  const [accepted, setAccepted] = useState(null);
  const [list, setList] = useState({ status: 'loading', sets: [], error: null });
  const [detail, setDetail] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'open'|'close', set }
  const [deleteTarget, setDeleteTarget] = useState(null); // the DRAFT set pending delete confirmation
  const [itemDialog, setItemDialog] = useState(null); // { item, nextStatus } - showing/hiding one question
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await questionSetApi.list();
      setList({ status: 'ready', sets: res.sets, error: null });
    } catch (err) {
      setList({ status: 'error', sets: [], error: err.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file) => {
    setRejected(null);
    setAccepted(null);
    setFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) {
      setRejected({ message: 'The file must be an .xlsx workbook.', total: 0, problems: [] });
      return;
    }
    if (file.size > MAX_BYTES) {
      setRejected({ message: 'The file is larger than 2 MB.', total: 0, problems: [] });
      return;
    }
    setBusy(true);
    try {
      const res = await questionSetApi.upload(file, ageGroup);
      setAccepted(res);
      toast.push({ type: 'success', message: res.created ? `${res.versionLabel} saved as a draft.` : 'No change — this exact file is already saved.' });
      load();
    } catch (err) {
      const problems = Array.isArray(err.details) ? err.details : [];
      setRejected({ message: err.message, total: err.totalProblems || problems.length, problems });
      toast.push({ type: 'error', message: 'Upload failed — nothing was saved.' });
    } finally {
      setBusy(false);
    }
  };

  const showDetail = async (id) => {
    try { setDetail(await questionSetApi.get(id)); } catch (err) { setProblem(err.message); }
  };

  const act = async (fn, okMessage) => {
    setWorking(true);
    setProblem(null);
    try {
      await fn();
      toast.push({ type: 'success', message: okMessage });
      setDialog(null);
      setReason('');
      await load();
      if (detail) await showDetail(detail.setId);
    } catch (err) {
      setProblem(err.message); // the server names what is missing (for example the domains without a question)
    } finally {
      setWorking(false);
    }
  };

  const freeze = (set) => act(() => questionSetApi.freeze(set.setId), `${set.versionLabel} frozen.`);
  const confirmAction = () => {
    const { kind, set } = dialog;
    return act(() => questionSetApi[kind](set.setId, reason.trim()), kind === 'open' ? `${set.versionLabel} is open.` : `${set.versionLabel} is closed.`);
  };
  const confirmDelete = () => act(
    () => questionSetApi.delete(deleteTarget.setId).then((r) => { setDeleteTarget(null); if (detail && detail.setId === deleteTarget.setId) setDetail(null); return r; }),
    `${deleteTarget.versionLabel} deleted.`,
  );

  const confirmItemStatus = async () => {
    const { item, nextStatus } = itemDialog;
    setWorking(true);
    setProblem(null);
    try {
      await questionSetApi.setItemStatus(detail.setId, item.itemId, nextStatus, reason.trim());
      toast.push({ type: 'success', message: nextStatus === 'RETIRED' ? `${item.itemCode} is now hidden from participants.` : `${item.itemCode} is now shown to participants.` });
      setItemDialog(null);
      setReason('');
      await showDetail(detail.setId);
    } catch (err) {
      setProblem(err.message); // e.g. SET_INCOMPLETE names the domain that would be left with nothing showing
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <PageHeader title="Question sets" description="Upload a question workbook, review it, freeze it, then open it for participants. A frozen set never changes." />

      <div className={pageStyles.asideCol}>
        <div className={pageStyles.stack}>
          <Panel
            title="Upload a question set"
            actions={(
              <Button type="button" variant="secondary" onClick={() => questionSetApi.downloadTemplate().catch((e) => setProblem(e.message))}>
                <Download size={16} aria-hidden="true" /> Download template
              </Button>
            )}
          >
            <fieldset className={styles.groupChoice}>
              <legend className={styles.legend}>Age group</legend>
              {AGE_GROUPS.map((g) => (
                <label key={g.value} className={styles.radio}>
                  <input type="radio" name="ageGroup" value={g.value} checked={ageGroup === g.value} onChange={() => setAgeGroup(g.value)} />
                  {g.label}
                </label>
              ))}
            </fieldset>
            <FileDropzone accept=".xlsx" onFile={handleFile} busy={busy} selectedName={fileName} title="Drop a question workbook (.xlsx) here, or browse" hint="Up to 2 MB and 500 questions; 2 to 20 options per question" />

            {accepted && (
              <div className={pageStyles.spaceTop}>
                <StatusMessage type="success" message={accepted.created ? 'Saved as a draft.' : 'This exact file was already saved — nothing changed.'} />
                <dl className={styles.summary}>
                  <div><dt>Label</dt><dd>{accepted.versionLabel} (revision {accepted.revision})</dd></div>
                  <div><dt>Questions</dt><dd>{accepted.questionCount}</dd></div>
                  <div><dt>Options in total</dt><dd>{accepted.optionCount}</dd></div>
                  <div><dt>Status</dt><dd>{accepted.status} · participation {accepted.participationState}</dd></div>
                </dl>
                {accepted.supersededRevision && <p>Revision {accepted.supersededRevision} was replaced by this upload.</p>}
                {accepted.warnings && accepted.warnings.length > 0 && (
                  <ul className={styles.warnings} aria-label="Warnings">
                    {accepted.warnings.map((w, i) => <li key={`${w.code}-${w.row}-${w.column}-${i}`}>{w.message}</li>)}
                  </ul>
                )}
              </div>
            )}

            {rejected && (
              <div className={pageStyles.spaceTop}>
                <StatusMessage type="error" message={rejected.total ? `The file has ${rejected.total} problem${rejected.total === 1 ? '' : 's'}. Nothing was saved.` : rejected.message} />
                {rejected.problems.length > 0 && (
                  <div className={tableStyles.scroll}>
                    <table className={tableStyles.table}>
                      <caption className="sr-only">Problems found in the file</caption>
                      <thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Problem</th><th scope="col">What to do</th></tr></thead>
                      <tbody>
                        {rejected.problems.map((p, i) => (
                          <tr key={`${p.row}-${p.column}-${p.code}-${i}`}>
                            <td>{p.row ?? '—'}</td>
                            <td>{p.column ?? '—'}</td>
                            <td><code>{p.code}</code></td>
                            <td className={styles.wrap}>{p.message}{hint(p.code) ? ` ${hint(p.code)}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {rejected.total > rejected.problems.length && rejected.problems.length > 0 && <p>Showing the first {rejected.problems.length} of {rejected.total}.</p>}
              </div>
            )}
          </Panel>

          {problem && !deleteTarget && <StatusMessage type="error" message={problem} />}

          <Panel title="Question sets">
            {list.status === 'error' && <StatusMessage type="error" message={list.error} />}
            {list.status === 'ready' && list.sets.length === 0 && <EmptyState message="No question sets yet. Upload a workbook above to create the first draft." />}
            {list.sets.length > 0 && (
              <div className={tableStyles.scroll}>
                <table className={tableStyles.table}>
                  <caption className="sr-only">Question sets</caption>
                  <thead>
                    <tr>
                      <th scope="col">Label</th><th scope="col">Revision</th><th scope="col">Age group</th><th scope="col">Status</th>
                      <th scope="col">Participation</th><th scope="col" className={tableStyles.num}>Questions</th><th scope="col" className={tableStyles.num}>Options</th><th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.sets.map((s) => (
                      <tr key={s.setId}>
                        <td>{s.versionLabel}</td>
                        <td>{s.revision}</td>
                        <td>{s.ageGroup === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'}</td>
                        <td><StatusPill status={s.status} label={s.status} tone={STATUS_TONE[s.status]} /></td>
                        <td>{s.participationState}</td>
                        <td className={tableStyles.num}>{s.questionCount}</td>
                        <td className={tableStyles.num}>{s.optionCount}</td>
                        <td>
                          <span className={styles.actions}>
                            <Button type="button" variant="secondary" onClick={() => showDetail(s.setId)} aria-label={`Review ${s.versionLabel} revision ${s.revision}`}>Review</Button>
                            {s.status === 'DRAFT' && <Button type="button" onClick={() => freeze(s)} disabled={working} aria-label={`Freeze ${s.versionLabel} revision ${s.revision}`}>Freeze</Button>}
                            {s.status === 'DRAFT' && <Button type="button" variant="secondary" tone="error" onClick={() => { setProblem(null); setDeleteTarget(s); }} disabled={working} aria-label={`Delete ${s.versionLabel} revision ${s.revision}`}>Delete</Button>}
                            {s.status === 'FROZEN' && s.participationState !== 'OPEN' && <Button type="button" onClick={() => { setDialog({ kind: 'open', set: s }); setReason(''); }} aria-label={`Open ${s.versionLabel} for participation`}>Open</Button>}
                            {s.status === 'FROZEN' && s.participationState === 'OPEN' && <Button type="button" variant="secondary" onClick={() => { setDialog({ kind: 'close', set: s }); setReason(''); }} aria-label={`Close ${s.versionLabel}`}>Close</Button>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title={detail ? `${detail.versionLabel} · revision ${detail.revision}` : 'Review'}
          subtitle={detail ? `${detail.questionCount} questions, ${detail.optionCount} options` : 'Choose "Review" on a set to read its questions and options.'}
          actions={detail && <Button type="button" variant="secondary" onClick={() => setDetail(null)} aria-label={`Close review of ${detail.versionLabel} revision ${detail.revision}`}>Close</Button>}
        >
          {!detail && <EmptyState message="Nothing selected. Read every question and its options before freezing." />}
          {detail && (
            <ol className={styles.questions}>
              {detail.questions.map((q) => (
                <li key={q.itemId}>
                  <p>
                    <strong>{q.itemCode}</strong> · {q.subdomainName} · {q.ageBand} · {q.context}
                    {q.status === 'RETIRED' && <StatusPill tone="neutral" label="Hidden from participants" />}
                  </p>
                  <p>{q.text}</p>
                  <ol className={styles.options} aria-label={`Options for ${q.itemCode}`}>
                    {q.options.map((o) => <li key={o.position}>{o.text}</li>)}
                  </ol>
                  {detail.status === 'FROZEN' && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => { setProblem(null); setReason(''); setItemDialog({ item: q, nextStatus: q.status === 'RETIRED' ? 'ACTIVE' : 'RETIRED' }); }}
                      aria-label={q.status === 'RETIRED' ? `Show ${q.itemCode} to participants` : `Hide ${q.itemCode} from participants`}
                    >
                      {q.status === 'RETIRED' ? 'Show to participants' : 'Hide from participants'}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {dialog && (
        <ConfirmDialog
          open
          title={ACTION_COPY[dialog.kind].title}
          message={ACTION_COPY[dialog.kind].message}
          confirmLabel={ACTION_COPY[dialog.kind].confirm}
          busy={working}
          confirmDisabled={reason.trim().length < 3}
          onConfirm={confirmAction}
          onCancel={() => { setDialog(null); setReason(''); }}
        >
          <label className={styles.reasonLabel} htmlFor="qs-reason">Reason (required, 3 to 300 characters)</label>
          <textarea id="qs-reason" className={styles.reason} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          title={`Delete ${deleteTarget.versionLabel}?`}
          message="This draft and its questions are gone for good. It was never frozen, so nothing else on the platform depends on it. A frozen set can never be deleted."
          confirmLabel="Delete"
          tone="error"
          busy={working}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          {problem && <StatusMessage type="error" message={problem} />}
        </ConfirmDialog>
      )}

      {itemDialog && (
        <ConfirmDialog
          open
          title={itemDialog.nextStatus === 'RETIRED' ? `Hide ${itemDialog.item.itemCode} from participants?` : `Show ${itemDialog.item.itemCode} to participants?`}
          message={itemDialog.nextStatus === 'RETIRED'
            ? 'Participants will no longer be given this question. It stays here for review and can be shown again at any time. Refused if this would leave its domain with no question showing.'
            : 'Participants may be given this question again, alongside the others in its domain.'}
          confirmLabel={itemDialog.nextStatus === 'RETIRED' ? 'Hide' : 'Show'}
          tone={itemDialog.nextStatus === 'RETIRED' ? 'warning' : 'brand'}
          busy={working}
          confirmDisabled={reason.trim().length < 3}
          onConfirm={confirmItemStatus}
          onCancel={() => { setItemDialog(null); setReason(''); }}
        >
          <label className={styles.reasonLabel} htmlFor="qs-item-reason">Reason (required, 3 to 300 characters)</label>
          <textarea id="qs-item-reason" className={styles.reason} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          {problem && <StatusMessage type="error" message={problem} />}
        </ConfirmDialog>
      )}
    </>
  );
}

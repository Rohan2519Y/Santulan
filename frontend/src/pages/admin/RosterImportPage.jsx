import { useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import FileDropzone from '../../components/FileDropzone/FileDropzone';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { useToast } from '../../components/Toast/Toast';
import { adminApi } from '../../services/santulanApi';
import useAdminData from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Roster import in three steps: choose the institution and cohort and the file, VALIDATE (row errors, nothing is written), then COMMIT
 * (all-or-nothing, only after a clean validation) and download the one-time credential file. Error rows show the row number, field and
 * code - never the personal values.
 */
export default function RosterImportPage() {
  const toast = useToast();
  const institutions = useAdminData(() => adminApi.institutions(), []);
  const [institutionId, setInstitutionId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null); // validation result for the current file
  const [committed, setCommitted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const chosen = institutions.data && institutions.data.institutions.find((i) => i.institutionId === institutionId);
  const cohorts = chosen ? chosen.cohorts.filter((c) => c.status === 'ACTIVE') : [];
  const ready = institutionId && cohortId && file;

  const reset = () => { setCheck(null); setCommitted(null); setProblem(null); };
  const startNew = () => { reset(); setFile(null); setInstitutionId(''); setCohortId(''); };
  const pick = (f) => {
    reset();
    if (f.size > MAX_BYTES) { setProblem('That file is larger than 10 MB.'); return; }
    setFile(f);
  };

  const run = async (mode) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await adminApi.importRoster(file, { institutionId, cohortId, mode });
      if (mode === 'validate') setCheck(res);
      else { setCommitted(res); toast.push({ type: 'success', message: `${res.count} participants registered. Download the credential file now.` }); }
    } catch (err) {
      setProblem(err.message);
      if (err.details && Array.isArray(err.details.errors)) setCheck({ ok: false, errors: err.details.errors, warnings: [], eligible: {}, rowCount: 0 });
    } finally { setBusy(false); }
  };

  const download = async () => {
    try { await adminApi.downloadCredentials(committed.importId); toast.push({ type: 'success', message: 'Credential file downloaded. It cannot be downloaded again.' }); } catch (err) { setProblem(err.message); }
  };

  return (
    <>
      <PageHeader title="Roster import" description="Register a class or year group from a spreadsheet. Nothing is saved until the file passes validation and you commit it." />
      <div className={styles.stack}>
        <Panel title="1. Where and what">
          <div className={styles.filters}>
            <label className={styles.filterField}>
              Institution
              <select value={institutionId} onChange={(e) => { setInstitutionId(e.target.value); setCohortId(''); reset(); }}>
                <option value="">Choose…</option>
                {(institutions.data ? institutions.data.institutions.filter((i) => i.status === 'ACTIVE') : []).map((i) => <option key={i.institutionId} value={i.institutionId}>{i.institutionName}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              Cohort
              <select value={cohortId} onChange={(e) => { setCohortId(e.target.value); reset(); }} disabled={!institutionId}>
                <option value="">Choose…</option>
                {cohorts.map((c) => <option key={c.cohortId} value={c.cohortId}>{c.cohortName}</option>)}
              </select>
            </label>
          </div>
          <FileDropzone accept=".xlsx,.csv" onFile={pick} busy={busy} selectedName={file ? file.name : ''} title="Drop the roster file here, or browse" hint="Up to 10 MB" />
        </Panel>

        {problem && <StatusMessage type="error" message={problem} />}

        <Panel title="2. Validate" actions={<Button type="button" variant="secondary" onClick={() => run('validate')} disabled={!ready || busy}>Validate file</Button>}>
          {!check && <p className={styles.muted}>Validation reports every problem at once, by row number and field.</p>}
          {check && check.ok && (
            <StatusMessage type="success" message={`The file is valid: ${check.rowCount} rows${check.eligible ? ` (adolescent ${check.eligible.ADOLESCENT || 0}, emerging adult ${check.eligible.EMERGING_ADULT || 0})` : ''}.`} />
          )}
          {check && !check.ok && (
            <>
              <StatusMessage type="error" message={`The file has ${check.errors.length} problem${check.errors.length === 1 ? '' : 's'}. Nothing was saved.`} />
              <div className={tableStyles.scroll}>
                <table className={tableStyles.table}>
                  <caption className="sr-only">Roster problems</caption>
                  <thead><tr><th scope="col">Row</th><th scope="col">Field</th><th scope="col">Problem</th></tr></thead>
                  <tbody>{check.errors.map((e, i) => <tr key={`${e.row}-${e.field}-${i}`}><td className={tableStyles.num}>{e.row}</td><td>{e.field}</td><td>{e.code}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          {check && check.warnings && check.warnings.length > 0 && <p className={styles.muted}>{check.warnings.length} warning(s): {check.warnings.map((w) => w.code || w).join(', ')}</p>}
        </Panel>

        <Panel title="3. Commit" actions={<Button type="button" variant="primary" onClick={() => run('commit')} disabled={!check || !check.ok || busy || !!committed}>Commit import</Button>}>
          {!committed && <p className={styles.muted}>Commit is available only after a clean validation of this file. It registers everyone or no one.</p>}
          {committed && (
            <>
              <StatusMessage type="success" message={`${committed.count} participants registered.`} />
              <p className={styles.muted}>The credential file holds each participant&apos;s temporary sign-in. It can be downloaded once.</p>
              <span className={styles.rowActions}>
                <Button type="button" variant="primary" onClick={download}>Download credential file</Button>
                <Button type="button" variant="secondary" onClick={startNew}>Close</Button>
              </span>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

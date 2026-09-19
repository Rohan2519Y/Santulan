import { useState } from 'react';
import { importItemPool } from '../../services/assessmentApi';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import FileDropzone from '../../components/FileDropzone/FileDropzone';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import StatTile from '../../components/StatTile/StatTile';
import { useToast } from '../../components/Toast/Toast';
import { formatDateTime } from './adminMetrics';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 20;

const REQUIRED_COLUMNS = ['item_code', 'assessment_version', 'domain_code', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];

/** True when every row failed only because there is no item_code - i.e. this is not an item-pool workbook. */
const looksLikeWrongFile = (errors) => errors.length > 0 && errors.every((e) => e.column === 'item_code' && /required/i.test(e.message));

export default function ItemPoolsPage() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const handleFile = async (file) => {
    setError(null);
    setResult(null);
    setFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) {
      setError({ message: 'File must be an .xlsx workbook.', errors: [] });
      return;
    }
    if (file.size > MAX_BYTES) {
      setError({ message: 'File exceeds the 2 MB limit.', errors: [] });
      return;
    }
    setBusy(true);
    try {
      const res = await importItemPool(file);
      setResult(res.version);
      setHistory((h) => [{ ...res.version, fileName: file.name, at: new Date().toISOString() }, ...h]);
      toast.push({ type: 'success', message: `${res.version.versionLabel} imported — ${res.version.itemCount} items.` });
    } catch (err) {
      const errors = err.details?.errors || [];
      setError({ message: err.message, errors });
      toast.push({ type: 'error', message: 'Import failed — nothing was changed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Item pools" description="Import a frozen item pool. Participants use the newest active version; earlier attempts keep the version they took." />

      <div className={styles.asideCol}>
        <div className={styles.stack}>
          <Panel title="Import an item pool">
            <FileDropzone
              accept=".xlsx"
              onFile={handleFile}
              busy={busy}
              selectedName={fileName}
              title="Drop an item pool (.xlsx) here, or browse"
              hint="One workbook, up to 2 MB"
            />

            {result && (
              <div className={styles.spaceTop}>
                <StatusMessage type="success" message={result.reimported ? 'Re-import complete — the same version was refreshed.' : 'Import complete.'} />
                <div className={styles.resultGrid}>
                  <StatTile label="Version" value={result.versionLabel.replace('santulan-', '').replace('-pilot-v1.0', '')} hint={result.versionLabel} />
                  <StatTile label="Items" value={result.itemCount} hint="Imported" tone="success" />
                  <StatTile label="Active" value={result.active ? 'Yes' : 'No'} hint={result.active ? 'Participants get this version' : 'Not the live version'} tone={result.active ? 'success' : 'warning'} />
                </div>
              </div>
            )}

            {error && (
              <div className={styles.spaceTop}>
                <StatusMessage type="error" message={error.message} />
                {looksLikeWrongFile(error.errors) && (
                  <div className={styles.spaceTop}>
                    <StatusMessage
                      type="info"
                      message="This doesn't look like an item-pool workbook — no item_code column was found. Use the Adolescent or Emerging Adult TECH_READY item-pool file."
                    />
                  </div>
                )}
                {error.errors.length > 0 && (
                  <>
                    <table className={styles.errorTable}>
                      <caption className="sr-only">Rows that failed validation</caption>
                      <thead>
                        <tr>
                          <th scope="col">Row</th>
                          <th scope="col">Column</th>
                          <th scope="col">Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {error.errors.slice(0, MAX_ERRORS_SHOWN).map((e, i) => (
                          <tr key={i}>
                            <td>{e.row}</td>
                            <td>{e.column}</td>
                            <td>{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {error.errors.length > MAX_ERRORS_SHOWN && <p className={styles.muted}>…and {error.errors.length - MAX_ERRORS_SHOWN} more rows.</p>}
                  </>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Imported this session" subtitle="Cleared when you sign out" flush>
            {history.length === 0 ? (
              <p className={`${styles.muted} ${styles.emptyPad}`}>Nothing imported yet.</p>
            ) : (
              <div className={tableStyles.scroll}>
                <table className={tableStyles.table}>
                  <caption className="sr-only">Item pools imported in this session</caption>
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">Version</th>
                      <th scope="col" className={tableStyles.num}>
                        Items
                      </th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i}>
                        <td>{h.fileName}</td>
                        <td>{h.versionLabel}</td>
                        <td className={tableStyles.num}>{h.itemCount}</td>
                        <td>{formatDateTime(h.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="What the file needs">
          <ul className={styles.formatList}>
            <li>An <strong>.xlsx</strong> workbook, up to <strong>2 MB</strong>.</li>
            <li>
              Items on a sheet named <strong>01_Items</strong> (the first sheet is used if there is none).
            </li>
            <li>One header row, then one row per item, with these columns: {REQUIRED_COLUMNS.map((c, i) => (
              <span key={c}>
                <code>{c}</code>
                {i < REQUIRED_COLUMNS.length - 1 ? ', ' : '.'}
              </span>
            ))}</li>
            <li>
              <strong>One version per file</strong> — Adolescent or Emerging Adult, never mixed.
            </li>
            <li>
              Every item <code>status</code> must start with <strong>READY</strong>.
            </li>
            <li>Importing an existing version again refreshes it; past attempts are never altered.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

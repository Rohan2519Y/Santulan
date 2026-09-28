import { useState } from 'react';
import { Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import EmptyState from '../../components/EmptyState/EmptyState';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import StatusPill from '../../components/StatusPill/StatusPill';
import Skeleton from '../../components/Skeleton/Skeleton';
import BarChart from '../../components/BarChart/BarChart';
import Button from '../../components/Button/Button';
import { adminApi, questionSetApi, newKey } from '../../services/santulanApi';
import useAdminData from './useAdminData';
import styles from './adminPages.module.css';

/**
 * Per-question response distribution for one assessment: how many completed attempts chose each option, and how many
 * left the question unanswered. Aggregate counts only - no participant's individual answers appear on this page.
 * "Completed" means the attempt reached SUBMITTED or later; one still in progress hasn't skipped anything, it just
 * hasn't reached that question yet (ASSUMED - the contract has no report like this to define it).
 */
export default function ResponseDistributionPage() {
  const [setId, setSetId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const sets = useAdminData(() => questionSetApi.list(), []);
  const distribution = useAdminData(() => (setId ? questionSetApi.responseDistribution(setId) : Promise.resolve(null)), [setId]);

  const setOptions = sets.data ? sets.data.sets.filter((s) => s.status !== 'DRAFT') : [];
  const d = distribution.data;

  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  /** Requests the full nine-sheet research export for this assessment, waits for it to finish generating, then downloads it. */
  const downloadWorkbook = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const key = newKey('export');
      const anonymisationVersion = `response-distribution-auto-${new Date().toISOString().slice(0, 10)}`;
      const { exportId, status } = await adminApi.requestExport({ sourceAssessmentVersionId: setId, anonymisationVersion }, key);
      let current = status;
      for (let attempt = 0; current !== 'READY' && current !== 'FAILED' && attempt < 30; attempt += 1) {
        await sleep(1500);
        current = (await adminApi.exportStatus(exportId)).status;
      }
      if (current === 'READY') await adminApi.downloadExport(exportId);
      else if (current === 'FAILED') throw new Error('The export failed to generate. Please try again.');
      else throw new Error('The export is taking longer than expected. Check the Research exports page shortly.');
    } catch (err) { setExportError(err.message); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader
        title="Response distribution"
        description="How many participants chose each option, and how many skipped it, for every question in one assessment."
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

        {!setId && <EmptyState message="Choose an assessment above to see its response distribution." />}

        {setId && distribution.status === 'loading' && (
          <Panel><div aria-busy="true"><Skeleton height={200} /></div></Panel>
        )}
        {setId && distribution.status === 'error' && <StatusMessage type="error" message={distribution.error} />}

        {setId && distribution.status === 'ready' && d && (
          <>
            <Panel
              title={`${d.versionLabel} · revision ${d.revision}`}
              subtitle={`${d.totalAttempts} completed attempt${d.totalAttempts === 1 ? '' : 's'} · ${d.questionCount} questions`}
              actions={(
                <Button type="button" variant="secondary" onClick={downloadWorkbook} disabled={exporting}>
                  <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Download Excel'}
                </Button>
              )}
            >
              {exportError && <StatusMessage type="error" message={exportError} />}
              {d.totalAttempts === 0 && <p className={styles.muted}>No completed attempts yet for this assessment.</p>}
            </Panel>

            {d.items.map((item) => {
              const chartData = [
                ...item.options.map((o) => ({ key: `p${o.position}`, label: o.text, count: o.count })),
                { key: 'skipped', label: 'Skipped', count: item.skippedCount, tone: 'warning' },
              ];
              return (
                <Panel
                  key={item.itemId}
                  title={`${item.itemCode} · ${item.domainCode}`}
                  subtitle={item.questionText}
                  actions={item.status === 'RETIRED' ? <StatusPill tone="neutral" label="Hidden from participants" /> : null}
                >
                  <BarChart data={chartData} ariaLabel={`Answers for ${item.itemCode}`} unit="participants" />
                </Panel>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

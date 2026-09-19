import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Activity, CheckCheck, ShieldAlert, RefreshCw, ArrowRight, CircleCheck, FileUp } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import StatTile from '../../components/StatTile/StatTile';
import BarChart from '../../components/BarChart/BarChart';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import Button from '../../components/Button/Button';
import { computeMetrics, needsAttention, formatDateTime } from './adminMetrics';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

export default function OverviewPage({ submissions, status, error, onRefresh, updatedAt }) {
  const navigate = useNavigate();
  const metrics = useMemo(() => computeMetrics(submissions), [submissions]);
  const attention = useMemo(() => submissions.filter(needsAttention).slice(0, 5), [submissions]);

  const refresh = (
    <Button type="button" variant="secondary" onClick={onRefresh} disabled={status === 'loading'}>
      <RefreshCw size={16} aria-hidden="true" />
      Refresh
    </Button>
  );
  const description = updatedAt ? `Latest ${metrics.total} submissions · updated ${formatDateTime(updatedAt.toISOString())}` : 'Loading the latest submissions…';

  if (status === 'error') {
    return (
      <>
        <PageHeader title="Overview" actions={refresh} />
        <StatusMessage type="error" message={`Could not load submissions: ${error}`} />
      </>
    );
  }

  if (status === 'loading' && !updatedAt) {
    return (
      <>
        <PageHeader title="Overview" description={description} />
        <div aria-busy="true">
          <span className="sr-only" role="status">
            Loading overview…
          </span>
          <div className={styles.kpiGrid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={104} radius="var(--radius-lg)" />
            ))}
          </div>
          <Skeleton height={260} radius="var(--radius-lg)" className={styles.spaceTop} />
        </div>
      </>
    );
  }

  if (metrics.total === 0) {
    return (
      <>
        <PageHeader title="Overview" description={description} actions={refresh} />
        <Panel>
          <EmptyState
            icon={FileUp}
            message="No submissions yet. Import an item pool so participants can start."
            action={
              <Link to="/admin/item-pools" className={styles.linkButton}>
                Import an item pool <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Overview" description={description} actions={refresh} />

      <div className={styles.stack}>
        <div className={styles.kpiGrid}>
          <StatTile label="Total submissions" value={metrics.total} hint={metrics.total >= 200 ? 'Showing the latest 200 attempts' : 'Every attempt on record'} icon={ClipboardList} />
          <StatTile label="In progress" value={metrics.inProgress} hint="Started, not yet submitted" icon={Activity} tone="info" />
          <StatTile label="Completed" value={metrics.completed} hint={`${pct(metrics.completed, metrics.total)}% of submissions`} icon={CheckCheck} tone="success" />
          <StatTile label="Needs attention" value={metrics.needsAttention} hint={`${metrics.flagsTotal} quality ${metrics.flagsTotal === 1 ? 'flag' : 'flags'} in total`} icon={ShieldAlert} tone="warning" />
        </div>

        <div className={styles.twoCol}>
          <Panel title="Submissions by status" subtitle="Select a bar to see those submissions">
            <BarChart
              data={metrics.byStatus.map((d) => ({ key: d.key, label: d.label, count: d.count, tone: d.tone }))}
              ariaLabel="Submissions by status"
              onSelect={(d) => navigate(`/admin/submissions?status=${d.key}`)}
            />
          </Panel>
          <Panel title="By item-pool version" subtitle="Which instrument each submission used">
            {metrics.byVersion.length === 1 ? (
              // One category is a fact, not a comparison: state it instead of drawing a lone bar.
              <p className={styles.singleFact}>
                All <strong>{metrics.byVersion[0].count}</strong> submissions used <span className={styles.mono}>{metrics.byVersion[0].label}</span>.
              </p>
            ) : (
              <BarChart data={metrics.byVersion.map((d) => ({ key: d.label, label: d.label, count: d.count }))} ariaLabel="Submissions by item-pool version" />
            )}
          </Panel>
        </div>

        <div className={styles.twoCol}>
          <Panel
            title="Needs attention"
            subtitle="Quality flags, quality holds and invalid attempts"
            flush
            actions={
              <Link to="/admin/submissions?attention=1" className={styles.linkButton}>
                View all <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          >
            {attention.length === 0 ? (
              <p className={styles.allClear}>
                <CircleCheck size={20} aria-hidden="true" />
                Nothing needs attention right now.
              </p>
            ) : (
              <ul className={styles.attentionList}>
                {attention.map((s) => (
                  <li key={s.attemptId} className={styles.attentionItem}>
                    <span className={styles.mono}>{s.santulanId}</span>
                    <span className={styles.attentionMeta}>
                      <StatusPill status={s.status} />
                      {s.qualityFlagCount > 0 && <span className={tableStyles.flagChip}>{s.qualityFlagCount} flagged</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent submissions"
            flush
            actions={
              <Link to="/admin/submissions" className={styles.linkButton}>
                View all <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          >
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Five most recent submissions</caption>
                <thead>
                  <tr>
                    <th scope="col">Santulan ID</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={tableStyles.num}>
                      Sessions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.recent.map((s) => (
                    <tr key={s.attemptId}>
                      <td className={tableStyles.mono}>{s.santulanId}</td>
                      <td>
                        <StatusPill status={s.status} />
                      </td>
                      <td className={tableStyles.num}>{s.sessionCount} of 4</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

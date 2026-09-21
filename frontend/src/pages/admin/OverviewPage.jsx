import { Link } from 'react-router-dom';
import { Users, ClipboardList, RefreshCw, ShieldAlert, FileWarning, ArrowRight } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import StatTile from '../../components/StatTile/StatTile';
import BarChart from '../../components/BarChart/BarChart';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import StatusPill from '../../components/StatusPill/StatusPill';
import Skeleton from '../../components/Skeleton/Skeleton';
import Button from '../../components/Button/Button';
import { adminApi } from '../../services/santulanApi';
import { statusMeta } from './adminMetrics';
import useAdminData, { countsToList } from './useAdminData';
import styles from './adminPages.module.css';

const ATTEMPT_ORDER = ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'];
const REPORT_ORDER = ['PENDING', 'REPORT_READY', 'FAILED_RETRYABLE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'];
const EXPORT_ORDER = ['REQUESTED', 'GENERATING', 'READY', 'FAILED'];

const withTone = (list) => list.map((d) => ({ ...d, tone: statusMeta(d.key).tone }));

/** Operational overview: counts only, straight from the monitoring summary. No score, label or safeguarding detail is ever shown here. */
export default function OverviewPage() {
  const { status, data, error, reload } = useAdminData(() => adminApi.monitoring(), []);
  const refresh = (
    <Button type="button" variant="secondary" onClick={reload} disabled={status === 'loading'}>
      <RefreshCw size={16} aria-hidden="true" />
      Refresh
    </Button>
  );

  if (status === 'error') {
    return (
      <>
        <PageHeader title="Overview" actions={refresh} />
        <StatusMessage type="error" message={`Could not load the overview: ${error}`} />
      </>
    );
  }
  if (status === 'loading') {
    return (
      <>
        <PageHeader title="Overview" description="Loading…" />
        <div aria-busy="true">
          <span className="sr-only" role="status">Loading overview…</span>
          <div className={styles.kpiGrid}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={104} radius="var(--radius-lg)" />)}</div>
        </div>
      </>
    );
  }

  const attemptsTotal = Object.values(data.attempts.byState).reduce((n, c) => n + c, 0);
  const open = data.participation.controlPlane === 'OPEN';
  return (
    <>
      <PageHeader title="Overview" description="Counts only. Open a page from the menu for detail." actions={refresh} />
      <div className={styles.stack}>
        <div className={styles.kpiGrid}>
          <StatTile label="Participants" value={data.participants.total} icon={Users} hint={`${data.participants.byRoute.OPEN || 0} open, ${data.participants.byRoute.INSTITUTIONAL || 0} institutional`} />
          <StatTile label="Attempts" value={attemptsTotal} icon={ClipboardList} />
          <StatTile label="Reports to retry" value={data.reports.retryQueue} icon={FileWarning} tone={data.reports.retryQueue ? 'warning' : 'brand'} hint="Failed and waiting for a retry" />
          <StatTile label="Quality flags to review" value={data.qualityReview.unreviewed} icon={ShieldAlert} tone={data.qualityReview.unreviewed ? 'warning' : 'brand'} hint={`${data.qualityReview.reviewed} reviewed`} />
        </div>

        <Panel title="Participation" subtitle="New attempts start only when both gates are open">
          <ul className={styles.gateList}>
            <li><StatusPill tone={open ? 'success' : 'warning'} label={open ? 'Open' : 'Closed'} /> Assessment control (the on/off switch)</li>
            <li>
              <StatusPill tone={data.participation.openAgeGroups.length ? 'success' : 'warning'} label={data.participation.openAgeGroups.length ? 'Open' : 'None open'} />
              {' '}Question sets open for: {data.participation.openAgeGroups.length ? data.participation.openAgeGroups.join(', ') : 'no age group'}
            </li>
          </ul>
          <Link to="/admin/participation" className={styles.linkButton}>Assessment control <ArrowRight size={16} aria-hidden="true" /></Link>
        </Panel>

        <div className={styles.twoCol}>
          <Panel title="Attempts by state">
            {attemptsTotal ? <BarChart data={withTone(countsToList(data.attempts.byState, ATTEMPT_ORDER))} ariaLabel="Attempts by state" unit="attempts" /> : <p className={styles.muted}>No attempts yet.</p>}
          </Panel>
          <Panel title="Participants by status">
            <BarChart data={countsToList(data.participants.byStatus, ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'])} ariaLabel="Participants by status" unit="participants" />
          </Panel>
        </div>

        <div className={styles.twoCol}>
          <Panel title="Reports by state" actions={<Link to="/admin/reports" className={styles.linkButton}>Retry queue <ArrowRight size={16} aria-hidden="true" /></Link>}>
            {Object.keys(data.reports.byState).length ? <BarChart data={countsToList(data.reports.byState, REPORT_ORDER)} ariaLabel="Reports by state" unit="reports" /> : <p className={styles.muted}>No reports yet.</p>}
          </Panel>
          <Panel title="Research exports by state" actions={<Link to="/admin/exports" className={styles.linkButton}>Exports <ArrowRight size={16} aria-hidden="true" /></Link>}>
            {Object.keys(data.exports.byState).length ? <BarChart data={countsToList(data.exports.byState, EXPORT_ORDER)} ariaLabel="Research exports by state" unit="exports" /> : <p className={styles.muted}>No exports yet.</p>}
          </Panel>
        </div>

        {data.participants.byInstitution.length > 0 && (
          <Panel title="Participants by institution">
            <BarChart data={data.participants.byInstitution.map((i) => ({ key: i.institutionId, label: i.institutionCode || i.institutionId, count: i.count }))} ariaLabel="Participants by institution" unit="participants" />
          </Panel>
        )}
      </div>
    </>
  );
}

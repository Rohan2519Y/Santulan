import { useState } from 'react';
import { Users, ClipboardCheck, PlayCircle, CheckCircle2, UserPlus, UserCheck, Clock, ListChecks } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import StatTile from '../../components/StatTile/StatTile';
import StatusPill from '../../components/StatusPill/StatusPill';
import DonutChart from '../../components/DonutChart/DonutChart';
import LineChart from '../../components/LineChart/LineChart';
import BarChart from '../../components/BarChart/BarChart';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { adminApi, questionSetApi } from '../../services/santulanApi';
import useAdminData, { formatDate } from './useAdminData';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const CONSENT_TONE = { COMPLETED: 'success', PENDING: 'warning' };
const ASSESSMENT_TONE = { SUBMITTED: 'success', SCORING: 'success', SCORED: 'success', REPORT_READY: 'success', QUALITY_HOLD: 'success', STARTED: 'info', IN_PROGRESS: 'info', PAUSED: 'info', NOT_STARTED: 'neutral', CREATED: 'neutral' };
const BLANK_FILTERS = { assessmentVersionId: '', institutionId: '', cohortId: '', dateFrom: '', dateTo: '' };

/**
 * The admin dashboard (docs/Santulan 2.0/Dashboard.jpeg): a filter bar, KPI counts, two donut breakdowns, a recent-
 * participants table, a pending-actions panel, a day-bucketed progress line and a per-institution completion bar
 * chart. Counts and roster fields only - never a score, an evidence state or anything about a safeguarding trigger,
 * the same boundary as every other admin page. The mockup's numbered callout boxes are annotations explaining the
 * mockup to its reviewer, not part of the page itself, so they aren't reproduced here.
 */
export default function DashboardPage() {
  const [form, setForm] = useState(BLANK_FILTERS);
  const filters = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
  const { status, data, error } = useAdminData(() => adminApi.dashboard(filters), [JSON.stringify(filters)]);
  const sets = useAdminData(() => questionSetApi.list(), []);
  const institutions = useAdminData(() => adminApi.institutions(), []);

  const change = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'institutionId' ? { cohortId: '' } : {}) }));
  const setOptions = sets.data ? sets.data.sets.filter((s) => s.status !== 'DRAFT') : [];
  const chosenInstitution = institutions.data && institutions.data.institutions.find((i) => i.institutionId === form.institutionId);

  return (
    <>
      <PageHeader title="Dashboard" description="Simple, clean and focused only on what is needed during the pilot." />
      <div className={styles.stack}>
        <Panel title="Filters">
          <div className={styles.filters}>
            <label className={styles.filterField}>
              Assessment Version
              <select value={form.assessmentVersionId} onChange={change('assessmentVersionId')}>
                <option value="">All assessments</option>
                {setOptions.map((s) => <option key={s.setId} value={s.setId}>{s.versionLabel} r{s.revision}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              Institution
              <select value={form.institutionId} onChange={change('institutionId')}>
                <option value="">All institutions</option>
                {(institutions.data ? institutions.data.institutions : []).map((i) => <option key={i.institutionId} value={i.institutionId}>{i.institutionName}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              Cohort
              <select value={form.cohortId} onChange={change('cohortId')} disabled={!form.institutionId}>
                <option value="">All cohorts</option>
                {(chosenInstitution ? chosenInstitution.cohorts : []).map((c) => <option key={c.cohortId} value={c.cohortId}>{c.cohortName}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              From
              <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={form.dateFrom} onChange={change('dateFrom')} />
            </label>
            <label className={styles.filterField}>
              To
              <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={form.dateTo} onChange={change('dateTo')} />
            </label>
          </div>
        </Panel>

        {status === 'error' && <StatusMessage type="error" message={`Could not load the dashboard: ${error}`} />}
        {status === 'loading' && (
          <div aria-busy="true">
            <span className="sr-only" role="status">Loading dashboard…</span>
            <div className={styles.kpiGrid}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={104} radius="var(--radius-lg)" />)}</div>
          </div>
        )}

        {status === 'ready' && data && (
          <>
            <div className={styles.kpiGrid}>
              <StatTile label="Participants Added" value={data.kpis.participantsAdded} icon={Users} tone="brightBlue" />
              <StatTile label="Consents Completed" value={data.kpis.consentsCompleted} icon={ClipboardCheck} tone="brightGreen" hint={`${data.kpis.consentsPending} pending`} />
              <StatTile label="Assessments Started" value={data.kpis.assessmentsStarted} icon={PlayCircle} tone="brightPurple" hint={`${data.kpis.assessmentsNotStarted} not started`} />
              <StatTile label="Assessments Submitted" value={data.kpis.assessmentsSubmitted} icon={CheckCircle2} tone="brightOrange" hint={`${data.kpis.assessmentsInProgress} in progress`} />
            </div>

            <div className={styles.twoCol}>
              <Panel title="Assessment Completion Status">
                <DonutChart data={data.completionStatus.map((d) => ({ ...d, tone: { SUBMITTED: 'brightGreen', IN_PROGRESS: 'brightBlue', NOT_STARTED: 'brightOrange', CONSENT_PENDING: 'neutral' }[d.key] }))} centerLabel="Participants" ariaLabel="Assessment completion status" />
              </Panel>
              <Panel title="Consent Status (For Minors)">
                {data.consentStatus.total ? (
                  <DonutChart
                    data={data.consentStatus.breakdown.map((d) => ({ ...d, tone: { BOTH_VERIFIED: 'brightGreen', PARENT_PENDING: 'brightOrange', STUDENT_PENDING: 'brightBlue' }[d.key] }))}
                    total={data.consentStatus.total} centerLabel="Minors" ariaLabel="Consent status for minors"
                  />
                ) : <p className={styles.muted}>No minors in this scope.</p>}
              </Panel>
            </div>

            <div className={styles.twoCol}>
              <Panel title="Recent Participants" flush>
                {data.recentParticipants.length === 0 ? <EmptyState message="No participants in this scope yet." /> : (
                  <div className={tableStyles.scroll}>
                    <table className={tableStyles.table}>
                      <caption className="sr-only">Recent participants</caption>
                      <thead>
                        <tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Age</th><th scope="col">Institution</th><th scope="col">Cohort</th><th scope="col">Consent</th><th scope="col">Assessment</th><th scope="col">Added</th></tr>
                      </thead>
                      <tbody>
                        {data.recentParticipants.map((p) => (
                          <tr key={p.participantId}>
                            <td title={p.santulanId}>{p.santulanId.length > 7 ? `${p.santulanId.slice(0, 7)}…` : p.santulanId}</td>
                            <td>{p.name || <span className={styles.muted}>—</span>}</td>
                            <td>{p.age}</td>
                            <td>{p.institutionCode || '—'}</td>
                            <td>{p.cohortCode || '—'}</td>
                            <td><StatusPill tone={CONSENT_TONE[p.consentStatus]} label={p.consentStatus === 'COMPLETED' ? 'Completed' : 'Pending'} /></td>
                            <td><StatusPill tone={ASSESSMENT_TONE[p.assessmentStatus] || 'neutral'} label={p.assessmentStatus.replace(/_/g, ' ')} /></td>
                            <td>{formatDate(p.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title="Pending Actions">
                <ul className={styles.gateList}>
                  <li><UserPlus size={16} aria-hidden="true" /> Parent consent pending (minors) <strong>{data.pendingActions.parentConsentPending}</strong></li>
                  <li><UserCheck size={16} aria-hidden="true" /> Student consent pending (minors) <strong>{data.pendingActions.studentConsentPending}</strong></li>
                  <li><Clock size={16} aria-hidden="true" /> Participants not started assessment <strong>{data.pendingActions.notStarted}</strong></li>
                  <li><ListChecks size={16} aria-hidden="true" /> Assessments in progress (not submitted) <strong>{data.pendingActions.inProgress}</strong></li>
                </ul>
              </Panel>
            </div>

            <div className={styles.twoCol}>
              <Panel title="Assessment Progress Over Time">
                {data.progressOverTime.length ? (
                  <LineChart
                    points={data.progressOverTime}
                    series={[{ key: 'participantsAdded', label: 'Participants Added' }, { key: 'assessmentsStarted', label: 'Assessments Started' }, { key: 'assessmentsSubmitted', label: 'Assessments Submitted' }]}
                    ariaLabel="Assessment progress over time"
                  />
                ) : <p className={styles.muted}>No activity in this window yet.</p>}
              </Panel>
              <Panel title="Assessment Completion by Institution">
                {data.completionByInstitution.length ? (
                  <BarChart data={data.completionByInstitution.map((i) => ({ key: i.institutionId, label: i.institutionCode || i.institutionId, count: i.pct }))} ariaLabel="Assessment completion by institution" unit="%" />
                ) : <p className={styles.muted}>No institutional participants in this scope yet.</p>}
              </Panel>
            </div>
          </>
        )}
      </div>
    </>
  );
}

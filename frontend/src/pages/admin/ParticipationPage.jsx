import { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { adminApi } from '../../services/santulanApi';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import Skeleton from '../../components/Skeleton/Skeleton';
import { useToast } from '../../components/Toast/Toast';
import ReasonDialog from './ReasonDialog';
import useAdminData, { formatDate } from './useAdminData';
import styles from './adminPages.module.css';

const ACTIONS = [
  { state: 'OPEN', label: 'Reopen', icon: Play, tone: 'success', reasonRequired: false, text: 'Let participants start new attempts again.', done: 'Participation reopened.' },
  { state: 'PAUSED', label: 'Pause', icon: Pause, tone: 'warning', reasonRequired: true, text: 'Temporarily stop new attempts. Attempts already started keep their answers and can be resumed after you reopen.', done: 'Participation paused.' },
  { state: 'STOPPED', label: 'Stop', icon: Square, tone: 'error', reasonRequired: true, text: 'Stop new attempts, for example when the assessment window has ended. Existing attempts and question sets are not changed.', done: 'Participation stopped.' },
];
const WORD = { OPEN: 'Reopened', PAUSED: 'Paused', STOPPED: 'Stopped' };

/**
 * Assessment control. New attempts start only when BOTH gates are open: this switch (recorded in the audit log, the latest entry decides) and an
 * open question set for the participant's age group. Pausing or stopping needs a reason; every change is recorded with who made it and when.
 */
export default function ParticipationPage() {
  const toast = useToast();
  const control = useAdminData(() => adminApi.control(), []);
  const [pending, setPending] = useState(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const run = async (entry, reason) => {
    setWorking(true);
    setProblem(null);
    try {
      await adminApi.setControl(entry.state, reason);
      toast.push({ type: entry.state === 'OPEN' ? 'success' : 'warning', message: `${entry.done} It is recorded in the audit log.` });
      setPending(null);
      await control.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };
  const request = (entry) => { setProblem(null); if (entry.reasonRequired) setPending(entry); else run(entry, ''); };

  const d = control.data;
  const open = d && d.controlPlane === 'OPEN';
  return (
    <>
      <PageHeader title="Assessment control" description="Open, pause or stop participation for everyone. Every change is recorded with who made it and why." />
      {control.status === 'loading' && <div aria-busy="true"><Skeleton height={160} /></div>}
      {control.status === 'error' && <StatusMessage type="error" message={control.error} />}
      {d && (
        <div className={styles.stack}>
          <Panel title="Both gates" subtitle="A participant can start only when both are open">
            <ul className={styles.gateList}>
              <li><StatusPill tone={open ? 'success' : 'warning'} label={open ? 'Open' : 'Closed'} /> Assessment control{d.reason ? ` — “${d.reason}”` : ''}</li>
              <li>
                <StatusPill tone={d.openSets.length ? 'success' : 'warning'} label={d.openSets.length ? 'Open' : 'None open'} />{' '}
                Question sets: {d.openSets.length ? d.openSets.map((s) => `${s.ageGroup === 'ADOLESCENT' ? 'Adolescent' : 'Emerging adult'} — ${s.versionLabel} r${s.revision}`).join('; ') : 'no set is open for any age group'}
              </li>
            </ul>
            <p className={styles.muted}>Current state: {d.state.toLowerCase()}{d.changedAt ? ` since ${formatDate(d.changedAt)}` : ' (never changed)'}.</p>
          </Panel>

          <div className={styles.actionGrid}>
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.state} className={styles.actionCard}>
                  <span className={`${styles.actionIcon} ${styles[`tone-${a.tone}`]}`} aria-hidden="true"><Icon size={20} /></span>
                  <h2 className={styles.actionTitle}>{a.label} participation</h2>
                  <p className={styles.actionText}>{a.text}</p>
                  <Button type="button" variant="primary" tone={a.tone} onClick={() => request(a)} disabled={working || d.state === a.state}>{a.label}</Button>
                </div>
              );
            })}
          </div>
          {problem && !pending && <StatusMessage type="error" message={problem} />}

          <Panel title="Recent changes">
            {d.recent.length === 0 ? <p className={styles.muted}>No changes recorded yet.</p> : (
              <ul className={styles.gateList}>
                {d.recent.map((r, i) => <li key={`${r.changedAt}-${i}`}>{WORD[r.state] || r.state} · {formatDate(r.changedAt)}{r.reason ? ` — “${r.reason}”` : ''}</li>)}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        title={pending ? `${pending.label} participation?` : ''}
        message={pending ? pending.text : ''}
        confirmLabel={pending ? pending.label : 'Confirm'}
        tone={pending ? pending.tone : 'brand'}
        busy={working}
        problem={problem}
        onConfirm={(reason) => run(pending, reason)}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

import { useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { controlParticipation, getLastControl } from '../../services/assessmentApi';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { useToast } from '../../components/Toast/Toast';
import { formatDateTime } from './adminMetrics';
import styles from './adminPages.module.css';

const ACTIONS = [
  {
    action: 'REOPEN',
    label: 'Reopen',
    icon: Play,
    tone: 'success',
    confirm: false,
    text: 'Let participants start and continue attempts again.',
    done: 'Participation reopened.',
  },
  {
    action: 'PAUSE',
    label: 'Pause',
    icon: Pause,
    tone: 'warning',
    confirm: true,
    text: 'Temporarily stop new attempts. Attempts already in progress can be resumed after you reopen.',
    done: 'Participation paused.',
  },
  {
    action: 'STOP',
    label: 'Stop',
    icon: Square,
    tone: 'error',
    confirm: true,
    text: 'Close participation. Use this when the assessment window has ended.',
    done: 'Participation stopped.',
  },
];

export default function ParticipationPage() {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(null); // the ACTIONS entry awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(() => getLastControl());

  const run = async (entry) => {
    setBusy(true);
    try {
      const res = await controlParticipation({ action: entry.action, reason: reason.trim() || undefined });
      setLast({ action: res.control.action, reason: res.control.reason, at: res.control.createdAt });
      toast.push({ type: entry.action === 'REOPEN' ? 'success' : 'warning', message: `${entry.done} It is recorded in the audit log.` });
      setReason('');
      setPending(null);
    } catch (err) {
      toast.push({ type: 'error', message: `Could not record the action: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const request = (entry) => (entry.confirm ? setPending(entry) : run(entry));
  const lastEntry = last && ACTIONS.find((a) => a.action === last.action);

  return (
    <>
      <PageHeader title="Participation" description="Pause, stop or reopen participation for everyone. Every action is recorded with who did it and why." />

      <div className={styles.stack}>
        <Panel title="Note for the audit log">
          <Field
            label="Reason (optional)"
            name="reason"
            type="text"
            hint="Saved with the action in the audit log."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Panel>

        <div className={styles.actionGrid}>
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.action} className={styles.actionCard}>
                <span className={`${styles.actionIcon} ${styles[`tone-${a.tone}`]}`} aria-hidden="true">
                  <Icon size={20} />
                </span>
                <h2 className={styles.actionTitle}>{a.label} participation</h2>
                <p className={styles.actionText}>{a.text}</p>
                <Button type="button" variant="primary" tone={a.tone} onClick={() => request(a)} disabled={busy}>
                  {a.label}
                </Button>
              </div>
            );
          })}
        </div>

        <Panel title="Last action from this browser">
          {last ? (
            <StatusMessage
              type={last.action === 'REOPEN' ? 'success' : 'warning'}
              message={`${lastEntry ? lastEntry.label : last.action} recorded ${formatDateTime(last.at)}${last.reason ? ` — “${last.reason}”` : ''}`}
            />
          ) : (
            <p className={styles.muted}>No action recorded from this browser yet.</p>
          )}
          <p className={`${styles.muted} ${styles.spaceTop}`}>The service does not report the live participation state, so this shows only the last action recorded here — not whether participation is currently open.</p>
        </Panel>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `${pending.label} participation?` : ''}
        message={pending ? `${pending.text} ${reason.trim() ? `Reason: “${reason.trim()}”.` : 'No reason entered.'}` : ''}
        confirmLabel={pending ? pending.label : 'Confirm'}
        tone={pending ? pending.tone : 'brand'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => run(pending)}
      />
    </>
  );
}

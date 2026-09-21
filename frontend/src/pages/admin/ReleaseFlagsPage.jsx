import { useCallback, useEffect, useState } from 'react';
import { releaseFlagApi } from '../../services/santulanApi';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import Skeleton from '../../components/Skeleton/Skeleton';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { useToast } from '../../components/Toast/Toast';
import styles from './releaseFlags.module.css';

// TODO(copy): the descriptions are placeholder text awaiting the content owner.
const FLAGS = [
  { flag: 'pilotS2', label: 'Pilot S2 scoring', help: 'Off: every domain stays research-only (S1) and no capability wording is shown. On: a domain with enough answers is scored at the pilot level (S2) and its approved wording is used in the report.' },
  { flag: 'advancedEvidence', label: 'Advanced evidence states', help: 'Off: nothing above S2 is assigned. On: the governed configuration may assign S3 to S5.' },
  { flag: 'developmentRelease', label: 'Development release', help: 'Off: priorities, actions and growth plans are prepared but hidden from participants. On: participants can see them.' },
  { flag: 'pathwayRelease', label: 'Pathway release', help: 'Off: no pathway route is released to participants. On: released routes can reach participants.' },
];

const when = (iso) => (iso ? new Date(iso).toLocaleString() : null);

/** The four release switches: server state only (no local toggle), every change needs a reason and is audited. */
export default function ReleaseFlagsPage() {
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', flags: null, error: null });
  const [dialog, setDialog] = useState(null); // { flag, label, next }
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', flags: await releaseFlagApi.list(), error: null });
    } catch (err) {
      setState({ status: 'error', flags: null, error: err.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const close = () => { setDialog(null); setReason(''); setProblem(null); };
  const confirm = async () => {
    setWorking(true);
    setProblem(null);
    try {
      await releaseFlagApi.set(dialog.flag, dialog.next, reason.trim());
      toast.push({ type: 'success', message: `${dialog.label} is now ${dialog.next ? 'on' : 'off'}.` });
      close();
      await load(); // the page always shows what the server holds
    } catch (err) {
      setProblem(err.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <PageHeader title="Release switches" description="Four switches decide what participants can see. All start off. Every change needs a reason and is recorded with who made it and when." />
      {state.status === 'loading' && <div aria-busy="true"><Skeleton /></div>}
      {state.status === 'error' && <StatusMessage type="error" message={state.error} />}
      {state.status === 'ready' && (
        <Panel title="Switches">
          <ul className={styles.list}>
            {FLAGS.map(({ flag, label, help }) => {
              const current = state.flags[flag] || { value: false };
              return (
                <li key={flag} className={styles.row}>
                  <div>
                    <div className={styles.name}>{label} <StatusPill tone={current.value ? 'success' : 'neutral'} label={current.value ? 'On' : 'Off'} /></div>
                    <p className={styles.help}>{help}</p>
                    <p className={styles.meta}>
                      {current.changedAt ? `Last changed ${when(current.changedAt)}${current.reason ? ` — “${current.reason}”` : ''}` : 'Never changed (default off)'}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => setDialog({ flag, label, next: !current.value })} aria-label={`${current.value ? 'Turn off' : 'Turn on'} ${label}`}>
                    {current.value ? 'Turn off' : 'Turn on'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {dialog && (
        <ConfirmDialog
          open
          title={`${dialog.next ? 'Turn on' : 'Turn off'} ${dialog.label}`}
          message={dialog.next ? 'This takes effect at once for everyone.' : 'This takes effect at once for everyone. Nothing already stored is changed.'}
          confirmLabel={dialog.next ? 'Turn on' : 'Turn off'}
          busy={working}
          confirmDisabled={reason.trim().length < 3}
          onConfirm={confirm}
          onCancel={close}
        >
          <label className={styles.reasonLabel} htmlFor="rf-reason">Reason (required, 3 to 300 characters)</label>
          <textarea id="rf-reason" className={styles.reason} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          {problem && <StatusMessage type="error" message={problem} />}
        </ConfirmDialog>
      )}
    </>
  );
}

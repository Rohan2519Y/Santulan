import { useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import styles from './adminPages.module.css';

/** A confirmation that asks for a reason (3 to 300 characters) before the action can be confirmed. The parent supplies `problem` after a refusal. */
export default function ReasonDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'brand', busy = false, problem = null, required = true, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const ok = !required && reason.trim() === '' ? true : reason.trim().length >= 3;
  const close = () => { setReason(''); onCancel(); };
  if (!open) return null;
  return (
    <ConfirmDialog open title={title} message={message} confirmLabel={confirmLabel} tone={tone} busy={busy} confirmDisabled={!ok} onConfirm={() => onConfirm(reason.trim())} onCancel={close}>
      <label className={styles.reasonLabel} htmlFor="admin-reason">{required ? 'Reason (required, 3 to 300 characters)' : 'Reason (optional, 3 to 300 characters)'}</label>
      <textarea id="admin-reason" className={styles.reasonBox} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      {problem && <StatusMessage type="error" message={problem} />}
    </ConfirmDialog>
  );
}

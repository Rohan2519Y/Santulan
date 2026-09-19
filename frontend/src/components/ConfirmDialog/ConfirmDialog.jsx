import Modal from '../Modal/Modal';
import Button from '../Button/Button';

/**
 * A yes/no confirmation. Focus starts on Cancel so a stray Enter never triggers the action.
 * `tone` colours the confirm button (error for destructive actions).
 */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'brand', busy = false, onConfirm, onCancel, children }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </Button>
          <Button type="button" variant="primary" tone={tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

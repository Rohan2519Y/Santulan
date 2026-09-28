import { Check } from 'lucide-react';
import Modal from '../../components/Modal/Modal';
import Button from '../../components/Button/Button';
import { CONSENT_TEXT } from './consentText';
import ConsentSections from './ConsentSections';
import cs from './ConsentFormModal.module.css';

/**
 * The full consent form as a popup (screens: Consent Form). `role` is the participant's declared route, already
 * derived from the age entered in step 3 ('minor' -> Parent / Guardian consent, 'adult' -> the emerging adult's own
 * consent) - the copy shown here follows it directly, with no re-selection (same reasoning as step 4 itself).
 */
export default function ConsentFormModal({ open, onClose, role, onAgree }) {
  const relationship = role === 'adult' ? 'adult' : 'parent';
  const copy = CONSENT_TEXT[relationship];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={<span className={cs.title}>Consent Form</span>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAgree(relationship)}><Check size={18} aria-hidden="true" />Agree &amp; Approve</Button>
        </>
      )}
    >
      <ConsentSections copy={copy} />

      <div className={cs.statement}>
        <p className={cs.statementTitle}>Consent Statement:</p>
        <p className={cs.paragraph}>By clicking to agree, I confirm that:</p>
        <ul className={cs.bullets}>
          {copy.consentStatement.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </Modal>
  );
}

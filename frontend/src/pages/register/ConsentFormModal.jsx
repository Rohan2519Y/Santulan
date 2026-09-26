import { useState } from 'react';
import { Check, UserRound, Users } from 'lucide-react';
import Modal from '../../components/Modal/Modal';
import Button from '../../components/Button/Button';
import { CONSENT_TEXT } from './consentText';
import ConsentSections from './ConsentSections';
import cs from './ConsentFormModal.module.css';

/**
 * The full consent form as a popup (screens: Consent Form). `role` is the participant's declared
 * route ('minor' -> Parent / Guardian consent, 'adult' -> the emerging adult's own consent); the
 * relationship toggle lets a minor's flow stay on the parent copy while still showing both options.
 */
export default function ConsentFormModal({ open, onClose, role, onAgree }) {
  const [relationship, setRelationship] = useState(role === 'adult' ? 'adult' : 'parent');
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
      <div className={cs.switcher}>
        <p className={cs.switcherLabel}>Please select your relationship to the participant:</p>
        <div className={cs.switcherRow}>
          <label className={`${cs.switcherOption} ${relationship === 'parent' ? cs.switcherOptionActive : ''}`.trim()}>
            <input type="radio" name="consent-relationship" value="parent" checked={relationship === 'parent'} onChange={() => setRelationship('parent')} />
            <UserRound size={18} aria-hidden="true" />
            Parent / Guardian
          </label>
          <label className={`${cs.switcherOption} ${relationship === 'adult' ? cs.switcherOptionActive : ''}`.trim()}>
            <input type="radio" name="consent-relationship" value="adult" checked={relationship === 'adult'} onChange={() => setRelationship('adult')} />
            <Users size={18} aria-hidden="true" />
            Emerging Adult Participant
          </label>
        </div>
      </div>

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

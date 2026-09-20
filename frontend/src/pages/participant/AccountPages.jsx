/*
 * Profile and Privacy (screens 20, 24). The profile shows ONLY what the canonical schema holds: Santulan ID, route, track /
 * age band and language. There is no name, photo, date of birth, interests or goals. Privacy lists every consent record with a
 * Withdraw action (confirmed first); requests about data are static text (approved contact details pending: TODO(copy)).
 */
import { useEffect, useState } from 'react';
import styles from '../../styles/ui.module.css';
import { Link } from 'react-router-dom';
import { Breadcrumb, CopyField, RailCard, Toggle } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api } from '../../services/santulanApi';
import { getReduceMotion, getTheme, setReduceMotion, setTheme } from '../../services/preferences';
import { SupportPage } from '../public/PublicPages';

const TRACK = { ADOLESCENT: 'Ages 13 to 17', EMERGING_ADULT: 'Ages 18 to 25' };
const ROUTE = { OPEN: 'Registered on my own', INSTITUTIONAL: 'Registered by my school or college' };
const TYPE = { PARENT_GUARDIAN_CONSENT: 'Parent or guardian consent', STUDENT_ASSENT: 'Your assent', ADULT_SELF_CONSENT: 'Your consent' };
const STATUS = { PENDING: 'Waiting', GRANTED: 'Given, waiting to be verified', VERIFIED: 'Verified', WITHDRAWN: 'Withdrawn' };

export function ProfilePage() {
  const [reg, setReg] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.registrationState().then(setReg).catch((e) => setError(e.message)); }, []);
  if (error) return <StatusMessage type="error" message={error} />;
  if (!reg) return <div aria-busy="true"><Skeleton /></div>;
  return (
    <div className={styles.stack}>
      <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile' }]} />
      <h1 className={styles.h2}>My profile</h1>
      <CopyField label="Santulan ID" value={reg.santulanId} />
      <dl className={styles.stack}>
        <div><dt className={styles.muted}>How I registered</dt><dd>{ROUTE[reg.participationRoute]}</dd></div>
        <div><dt className={styles.muted}>Age range</dt><dd>{TRACK[reg.assessmentTrack]}</dd></div>
        <div><dt className={styles.muted}>Language</dt><dd>English</dd></div>
      </dl>
      <Link className={styles.pageLink} to="/student/profile/preferences">Preferences</Link>
    </div>
  );
}

export function PrivacyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(null);
  const load = () => api.consentRequirements().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const grant = async (id) => {
    setError('');
    try { await api.grantConsent(id); await load(); } catch (err) { setError(err.message); }
  };

  const withdraw = async (id) => {
    setError('');
    try { await api.withdrawConsent(id); setConfirming(null); await load(); } catch (err) { setError(err.message); }
  };

  if (!data && !error) return <div aria-busy="true"><Skeleton /></div>;
  return (
    <div className={styles.stack}>
      <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'Privacy and consent' }]} />
      <h1 className={styles.h2}>Privacy and consent</h1>
      {error && <StatusMessage type="error" message={error} />}
      {data && data.consents.length === 0 && <RailCard tone="sky" title="No consent records yet"><p>Your consent will appear here once it has been recorded.</p></RailCard>}
      {data && data.consents.map((c) => (
        <section key={c.consentId} className={`${styles.card} ${styles.toneBlue}`}>
          <h2 className={styles.h3}>{TYPE[c.consentType]}</h2>
          <p>Status: <strong>{STATUS[c.status]}</strong></p>
          {c.status === 'PENDING' && c.giverRelationship === 'SELF' && <Button onClick={() => grant(c.consentId)}>Give my consent</Button>}
          {c.status !== 'WITHDRAWN' && confirming !== c.consentId && <Button variant="secondary" onClick={() => setConfirming(c.consentId)}>Withdraw</Button>}
          {confirming === c.consentId && (
            <div role="alertdialog" aria-label="Confirm withdrawal" className={styles.stack}>
              <StatusMessage type="warning" message="If you withdraw, you will not be able to continue the assessment until consent is given again. Do you want to withdraw?" />
              <div className={styles.row}>
                <Button onClick={() => withdraw(c.consentId)}>Yes, withdraw</Button>
                <Button variant="secondary" onClick={() => setConfirming(null)}>Keep it</Button>
              </div>
            </div>
          )}
        </section>
      ))}
      <RailCard tone="note" title="Your data">
        <p>To ask about your data, please contact the programme team. TODO(copy): approved contact details.</p>
      </RailCard>
    </div>
  );
}

/** Preferences (screen 22, reduced): Language (only the locales that exist) and Theme, stored on this device only. */
export function PreferencesPage() {
  const [theme, setThemeState] = useState(getTheme());
  const [reduce, setReduce] = useState(getReduceMotion());
  return (
    <div className={styles.stack}>
      <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile', to: '/student/profile' }, { label: 'Preferences' }]} />
      <h1 className={styles.h2}>Preferences</h1>
      <Field as="select" label="Language" name="language" defaultValue="en">
        <option value="en">English</option>
      </Field>
      <Field as="select" label="Theme" name="theme" value={theme} onChange={(e) => { setThemeState(e.target.value); setTheme(e.target.value); }}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </Field>
      <Toggle label="Reduce motion" hint="Turns off animations and transitions." checked={reduce} onChange={(v) => { setReduce(v); setReduceMotion(v); }} />
      <p className={styles.muted}>These choices are saved on this device only.</p>
    </div>
  );
}

/** Screen 19, reduced: a calm thank-you with only the destinations that exist (no Take Action / Explore Resources while gated). */
export function ThanksPage() {
  return (
    <div className={styles.stack}>
      <h1 className={styles.h2}>Thank you</h1>
      <p className={styles.lead}>Thank you for taking the time to be here. TODO(copy): approved thank-you wording.</p>
      <div className={styles.tiles}>
        <section className={`${styles.card} ${styles.toneSky}`}>
          <h2 className={styles.h3}>Your report</h2>
          <Link className={styles.pageLink} to="/student/generating">See progress</Link>
        </section>
        <section className={`${styles.card} ${styles.toneLavender}`}>
          <h2 className={styles.h3}>We are here for you</h2>
          <Link className={styles.pageLink} to="/student/support">Go to Support</Link>
        </section>
      </div>
      <Link className={styles.pageLink} to="/student">Go to my dashboard</Link>
    </div>
  );
}

export const ParticipantSupport = () => <SupportPage embedded />;

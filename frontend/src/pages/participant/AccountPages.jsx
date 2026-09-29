/*
 * Profile, Privacy, Preferences and Thanks (screens 19, 20, 22, 24). The profile shows ONLY what the canonical schema holds:
 * Santulan ID, route, track / age band and language. There is no name, photo, date of birth, interests or goals, and no
 * completion ring. Privacy lists every consent record with a Withdraw action (confirmed first); requests about data are static
 * text (approved contact details pending: TODO(copy)). Preferences: Language, Theme and Reduce motion, stored on this device only.
 * The sample tabs are Personal information, Preferences and Privacy; Research profile (ValidationProfilePage) is an
 * ASSUMED fourth tab added so a participant can revisit/edit the demographic and research profile form later.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Globe, Info, Lock, ShieldCheck, UserRound, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { Breadcrumb, ButtonLink, CopyField, IconBadge, InfoNote, RailCard, Toggle } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { api } from '../../services/santulanApi';
import { getReduceMotion, getTheme, setReduceMotion, setTheme } from '../../services/preferences';
import { SupportPage } from '../public/PublicPages';
import { CONSENT_TEXT } from '../register/consentText';
import ConsentSections from '../register/ConsentSections';
import cs from '../register/ConsentFormModal.module.css';

const TRACK = { ADOLESCENT: 'Ages 13 to 17', EMERGING_ADULT: 'Ages 18 to 25' };
const ROUTE = { OPEN: 'Registered on my own', INSTITUTIONAL: 'Registered by my school or college' };
const TYPE = { PARENT_GUARDIAN_CONSENT: 'Parent or guardian consent', STUDENT_ASSENT: 'Your assent', ADULT_SELF_CONSENT: 'Your consent' };
const STATUS = { PENDING: 'Waiting', GRANTED: 'Given, waiting to be verified', VERIFIED: 'Verified', WITHDRAWN: 'Withdrawn' };

const TABS = [
  { to: '/student/profile', label: 'Personal information' },
  { to: '/student/validation-profile', label: 'Research profile' },
  { to: '/student/profile/preferences', label: 'Preferences' },
  { to: '/student/privacy', label: 'Privacy' },
];

/** The profile tabs; they are links, so each one is a real page and the current one is marked aria-current. */
export function ProfileTabs({ current }) {
  return (
    <nav aria-label="Profile sections" className={styles.tabs}>
      {TABS.map((t) => (
        <Link key={t.to} to={t.to} aria-current={t.to === current ? 'page' : undefined} className={`${styles.tab} ${t.to === current ? styles.tabActive : ''}`}>{t.label}</Link>
      ))}
    </nav>
  );
}

/** The right-hand column of the profile pages (samples 20, 22, 24). */
function ProfileRail({ slot }) {
  return (
    <div className={styles.rail}>
      <ImageSlot slot={slot} className={styles.railPicture} />
      <RailCard tone="safe" title="Your information is safe" icon={ShieldCheck}><p>We only keep what is needed for your participation. Your profile holds no name and no photo.</p></RailCard>
      <RailCard tone="help" title="Need Help?" icon={Users}><p>If you have any questions or need assistance, feel free to reach out to our support team.</p><Link className={styles.pageLink} to="/student/support">Contact Support</Link></RailCard>
    </div>
  );
}

export function ProfilePage() {
  const [reg, setReg] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.registrationState().then(setReg).catch((e) => setError(e.message)); }, []);
  if (error) return <StatusMessage type="error" message={error} />;
  if (!reg) return <div aria-busy="true"><Skeleton /></div>;
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile' }]} />
        <div>
          <h1 className={p.pageTitle}>My profile</h1>
          <p className={p.pageLead}>These are the details that come with your participation.</p>
        </div>
        <ProfileTabs current="/student/profile" />
        <section className={p.panel}>
          <h2 className={p.panelTitle}>Personal information</h2>
          <p className={styles.muted} style={{ margin: '0 0 var(--sp-5)' }}>This information helps us keep your participation on track.</p>
          <div className={p.profileGrid}>
            <span className={p.bigAvatar} aria-hidden="true"><UserRound size={56} strokeWidth={1.5} /></span>
            <div className={styles.stack}>
              <CopyField label="Santulan ID" value={reg.santulanId} hint="Keep this ID safe. You need it to sign in." />
              <dl className={p.fieldGrid}>
                <div className={p.readField}><dt>How I registered</dt><dd>{ROUTE[reg.participationRoute]}</dd></div>
                <div className={p.readField}><dt>Age range</dt><dd>{TRACK[reg.assessmentTrack]}</dd></div>
                <div className={p.readField}><dt>Language</dt><dd>English</dd></div>
              </dl>
              <InfoNote icon={Info}>Your information is safe with us. We only use it to run your participation.</InfoNote>
            </div>
          </div>
        </section>
      </div>
      <ProfileRail slot="profileHero" />
    </div>
  );
}

export function PrivacyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [agree, setAgree] = useState(false);
  const [working, setWorking] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
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

  // CR-006-13: an adult confirms their own consent with one checkbox (creates, grants and verifies in a single call). A
  // minor never sees this - they get the CR-006-14 checkbox below instead.
  const selfConsent = async () => {
    setError(''); setWorking(true);
    try { await api.selfConsent(); setAgree(false); setShowConsent(false); await load(); } catch (err) { setError(err.message); } finally { setWorking(false); }
  };

  // CR-006-14: a minor confirms their own assent AND attests their parent/guardian's consent with one checkbox, on their own
  // device - a temporary stand-in until a real parent/guardian portal exists. The admin-mediated flow (a real parent verifying
  // their own consent) still works unchanged alongside this.
  const minorSelfService = async () => {
    setError(''); setWorking(true);
    try { await api.minorSelfService(); setAgree(false); setShowConsent(false); await load(); } catch (err) { setError(err.message); } finally { setWorking(false); }
  };

  const closeConsent = () => { setShowConsent(false); setAgree(false); };

  if (!data && !error) return <div aria-busy="true"><Skeleton /></div>;
  const needsSelfConsent = data && data.isMinor === false
    && !data.consents.some((c) => c.consentType === 'ADULT_SELF_CONSENT' && c.status === 'VERIFIED');
  const needsMinorService = data && data.isMinor === true
    && !['STUDENT_ASSENT', 'PARENT_GUARDIAN_CONSENT'].every((t) => data.consents.some((c) => c.consentType === t && c.status === 'VERIFIED'));
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile', to: '/student/profile' }, { label: 'Privacy and consent' }]} />
        <div>
          <h1 className={p.pageTitle}>Privacy and consent</h1>
          <p className={p.pageLead}>Your privacy matters. Here is every consent on record for you, and what you can do with it.</p>
        </div>
        <ProfileTabs current="/student/privacy" />
        {error && <StatusMessage type="error" message={error} />}
        {(needsSelfConsent || needsMinorService) && (
          <section className={p.panel}>
            <h2 className={p.panelTitle}>Your consent</h2>
            <p className={styles.muted} style={{ margin: '0 0 var(--sp-3)' }}>
              {needsSelfConsent ? 'Confirm that you agree to take part. As an adult, this is your own consent to give.'
                : 'Your consent needs to be verified before you can begin - your own assent, and your parent or guardian’s.'}
            </p>
            <Button onClick={() => setShowConsent(true)}>Review consent form</Button>
          </section>
        )}
        <ConfirmDialog
          open={showConsent}
          title={needsSelfConsent ? 'Consent Form' : 'Parent / Guardian Consent'}
          confirmLabel={working ? 'Saving…' : 'Agree & Confirm'}
          cancelLabel="Cancel"
          busy={working}
          confirmDisabled={!agree}
          onConfirm={needsSelfConsent ? selfConsent : minorSelfService}
          onCancel={closeConsent}
        >
          <div className={styles.consentText}>
            {needsSelfConsent ? (
              <ConsentSections copy={CONSENT_TEXT.adult} />
            ) : (
              <>
                <p className={cs.paragraph}>
                  <em>There is no separate parent/guardian sign-in yet, so this device is used to confirm both your assent and your parent or guardian&apos;s consent together. This is the same consent form a parent or guardian would read — please go through it with them before confirming below.</em>
                </p>
                <ConsentSections copy={CONSENT_TEXT.parent} />
              </>
            )}
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-autofocus />
            <span>{needsSelfConsent ? 'I agree to take part in Santulan.' : 'I agree to take part, and my parent or guardian has agreed to this too.'}</span>
          </label>
        </ConfirmDialog>
        {data && data.consents.length === 0 && !needsSelfConsent && !needsMinorService && <RailCard tone="sky" title="No consent records yet"><p>Your consent will appear here once it has been recorded.</p></RailCard>}
        {data && data.consents.length > 0 && (
          <section className={p.panel}>
            <h2 className={p.panelTitle}>Your consents</h2>
            <p className={styles.muted} style={{ margin: 0 }}>Withdrawing a consent closes the assessment until it is given again.</p>
            <div className={p.rows}>
              {data.consents.map((c) => (
                <div key={c.consentId} className={p.row}>
                  <IconBadge icon={c.status === 'WITHDRAWN' ? Lock : ShieldCheck} tone={c.status === 'VERIFIED' ? 'green' : 'blue'} size="sm" />
                  <div>
                    <h3 className={p.rowTitle}>{TYPE[c.consentType]}</h3>
                    <p className={p.rowText}>Status: <strong>{STATUS[c.status]}</strong></p>
                  </div>
                  <div className={p.rowActions}>
                    {c.status === 'PENDING' && c.giverRelationship === 'SELF' && <Button onClick={() => grant(c.consentId)}>Give my consent</Button>}
                    {c.status !== 'WITHDRAWN' && confirming !== c.consentId && <Button variant="secondary" onClick={() => setConfirming(c.consentId)}>Withdraw</Button>}
                  </div>
                  {confirming === c.consentId && (
                    <div role="alertdialog" aria-label="Confirm withdrawal" className={p.confirm}>
                      <StatusMessage type="warning" message="If you withdraw, you will not be able to continue the assessment until consent is given again. Do you want to withdraw?" />
                      <div className={styles.row}>
                        <Button onClick={() => withdraw(c.consentId)}>Yes, withdraw</Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)}>Keep it</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <RailCard tone="note" title="Your data" icon={FileText}>
          <p>To ask about your data, please contact the programme team. TODO(copy): approved contact details.</p>
        </RailCard>
      </div>
      <ProfileRail slot="privacyHero" />
    </div>
  );
}

/** Preferences (screen 22, reduced): Language (only the locales that exist), Theme and Reduce motion, stored on this device only. */
export function PreferencesPage() {
  const [theme, setThemeState] = useState(getTheme());
  const [reduce, setReduce] = useState(getReduceMotion());
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'My profile', to: '/student/profile' }, { label: 'Preferences' }]} />
        <div>
          <h1 className={p.pageTitle}>Preferences</h1>
          <p className={p.pageLead}>Customise how Santulan looks on this device.</p>
        </div>
        <ProfileTabs current="/student/profile/preferences" />
        <section className={p.panel}>
          <div className={styles.row} style={{ flexWrap: 'nowrap', marginBottom: 'var(--sp-4)' }}>
            <IconBadge icon={Globe} tone="green" size="sm" />
            <div>
              <h2 className={p.panelTitle} style={{ fontSize: 22 }}>Display Preferences</h2>
              <p className={styles.muted} style={{ margin: 0 }}>Personalise the look and feel of your experience.</p>
            </div>
          </div>
          <div className={p.selects}>
            <Field as="select" size="lg" label="Theme" name="theme" value={theme} onChange={(e) => { setThemeState(e.target.value); setTheme(e.target.value); }}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Field>
            <Field as="select" size="lg" label="Language" name="language" defaultValue="en">
              <option value="en">English</option>
            </Field>
          </div>
          <Toggle label="Reduce motion" hint="Turns off animations and transitions." checked={reduce} onChange={(v) => { setReduce(v); setReduceMotion(v); }} />
          <p className={styles.muted} style={{ margin: 'var(--sp-4) 0 0' }}>These choices are saved on this device only.</p>
          <div className={p.buttonRow} style={{ marginTop: 'var(--sp-5)' }}>
            <ButtonLink to="/student/profile" variant="secondary" size="lg" block={false}><ArrowLeft size={20} aria-hidden="true" /> Back</ButtonLink>
          </div>
        </section>
      </div>
      <ProfileRail slot="preferencesHero" />
    </div>
  );
}

/** Screen 19, reduced: a calm thank-you with only the destinations that exist (no Take Action / Explore Resources while gated). */
export function ThanksPage() {
  return (
    <div className={styles.pageGrid}>
      <div className={p.page}>
        <div>
          <h1 className={p.pageTitle}>Thank you</h1>
          <p className={p.pageLead}>Thank you for taking the time to be here. TODO(copy): approved thank-you wording.</p>
        </div>
        <div className={p.thanksBanner}>
          <ImageSlot slot="thanksBanner" className={p.thanksBannerArt} />
          <p className={p.thanksScript} aria-hidden="true">A more self-aware you today, for a brighter tomorrow.</p>
        </div>
        <div className={p.fourUp}>
          <Link className={`${p.cardCentered} ${styles.toneLavender}`} to="/student/generating">
            <IconBadge icon={FileText} tone="lavender" size="lg" />
            <h2 className={styles.h3} style={{ margin: 0 }}>Your report</h2>
            <p className={styles.muted} style={{ margin: 0 }}>See how your report is coming along.</p>
          </Link>
          <Link className={`${p.cardCentered} ${styles.toneSky}`} to="/student/support">
            <IconBadge icon={Users} tone="blue" size="lg" />
            <h2 className={styles.h3} style={{ margin: 0 }}>We are here for you</h2>
            <p className={styles.muted} style={{ margin: 0 }}>Reach out to our support team whenever you need help.</p>
          </Link>
        </div>
        <div className={p.quoteBox}>
          <p>“Small steps today lead to big opportunities tomorrow.”</p>
          <span>— Team Santulan</span>
        </div>
        <div><ButtonLink to="/student" size="lg" icon block={false}>Go to my dashboard</ButtonLink></div>
      </div>
      <div className={styles.rail}>
        <ImageSlot slot="thanksPhoto" className={styles.railPicture} />
        <RailCard tone="sky" title="Stay connected" icon={Info}><p>Come back to your dashboard any time to check on your report.</p></RailCard>
        <RailCard tone="safe" title="Your privacy matters" icon={ShieldCheck}><p>Your information is safe with us and is only used to support your participation.</p></RailCard>
      </div>
    </div>
  );
}

export const ParticipantSupport = () => <SupportPage embedded />;

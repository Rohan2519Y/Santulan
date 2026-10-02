/*
 * Three-step registration wizard: 1 age + email + a password the participant chooses themselves 2 consent derived from
 * age 3 done, already signed in. No temporary password, no forced password change - unlike institutional registration
 * (which still issues a one-time temporary credential, AT-27), OPEN participants pick their own password up front and
 * the server returns a real session token immediately (registerOpen in registration.controller.js). The email IS the
 * login subject: it is what POST /auth/login expects back, no Santulan ID needed day to day (the ID is still shown once,
 * for their records). Consent records are created and verified by the privileged consent service, so step 2 reports
 * their real status instead of pretending they are done.
 *
 * Previously a five-step OTP wizard (contact -> code -> age -> consent -> done), then briefly a Santulan-ID +
 * temporary-password variant. No real OTP/SMS or email provider exists in this codebase (services/identity/index.js);
 * api.requestOtp/verifyOtp/declareAge remain defined in santulanApi.js, unused, for when a real OTP provider exists.
 *
 * Layout: a picture area on the left (an ImageSlot, white until a path is set) with the step's message, and the form card
 * on the right; below 1080 px the message shortens and below 640 px only the picture strip and the card remain.
 * Copy is placeholder text flagged TODO(copy).
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Info, Leaf, Lock, Mail, ShieldCheck, UserRound, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import s from '../../styles/site.module.css';
import { PublicLayout } from '../../components/layouts';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { StepIndicator, CopyField, IconBadge, InfoNote, ButtonLink } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api, newKey } from '../../services/santulanApi';
import { useSession } from '../../services/SessionContext';
import ConsentFormModal from './ConsentFormModal';

const LABELS = ['Age', 'Consent', 'Done'];

const CONSENT_CARDS = {
  PARENT_GUARDIAN_CONSENT: { title: 'Parent or guardian consent', tag: 'Parent / guardian', text: 'A parent or guardian reads and approves the consent form on your behalf before you can take part.' },
  STUDENT_ASSENT: { title: 'Your assent', tag: 'Self', text: 'You confirm that you are happy to take part, alongside your parent or guardian’s consent.' },
  ADULT_SELF_CONSENT: { title: 'Your consent', tag: 'Self-consent', text: 'You read and approve the consent form yourself before you can take part.' },
};

const isEligibleAge = (n) => Number.isInteger(n) && n >= 13 && n <= 25;

/** The message on the left of each step (samples 03, 04, 08 of the original five-step design). */
const HERO = {
  1: {
    title: 'Your Age Helps Us Support You Better',
    lead: 'Santulan is designed for adolescents and emerging adults. Please tell us your age so we can ensure the right guidance, consent process and support.',
    features: [[ShieldCheck, 'blue', 'Age-appropriate experience', 'Content and support suited to your age'], [Users, 'green', 'Additional consent where needed', 'For participants below 18 years'], [Lock, 'lavender', 'Your information is safe', 'We respect and protect your privacy']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
  2: {
    title: 'Consent Creates a Safer Space',
    lead: 'Santulan values your well-being and follows age-appropriate consent processes. This helps ensure a safe, supportive and responsible experience for everyone.',
    features: [[ShieldCheck, 'blue', 'Your Safety Matters', 'Age-appropriate consent for a secure experience'], [Users, 'green', 'Support from Parents/Guardians', 'For participants below 18 years'], [Lock, 'lavender', 'Your Information Stays Private', 'We respect your privacy']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
  3: {
    title: 'Your Account is Ready!',
    lead: 'You have successfully registered for Santulan and are already signed in. Here is your Santulan ID - keep it for your records.',
    features: [[Check, 'blue', 'Keep it safe', 'Your Santulan ID, for your own records'], [ShieldCheck, 'green', 'Your data is secure', 'Your information is used only for participation and support'], [Leaf, 'lavender', 'Next step', 'Your consent is verified, then you can begin']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
};

function Message({ step }) {
  const h = HERO[step];
  return (
    <div className={s.splitCopy}>
      {step > 1 && <p className={s.splitEyebrow}>Open route registration</p>}
      <p className={s.splitTitle}>{h.title}</p>
      <p className={s.splitLead}>{h.lead}</p>
      <ul className={s.splitFeatures}>
        {h.features.map(([Icon, tone, title, text]) => (
          <li key={title} className={s.splitFeature}>
            <IconBadge icon={Icon} tone={tone} size="sm" />
            <div><p className={s.splitFeatureTitle}>{title}</p><p className={s.splitFeatureText}>{text}</p></div>
          </li>
        ))}
      </ul>
      <p className={s.splitScript} aria-hidden="true">{h.script}</p>
    </div>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [step, setStep] = useState(1);
  const [ageText, setAgeText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [route, setRoute] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreedConsents, setAgreedConsents] = useState({});
  const [consentModalKey, setConsentModalKey] = useState(null);
  const idempotencyKey = useRef(newKey('reg')); // one key per registration attempt, reused on every retry

  const run = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const submitDetails = () => run(async () => {
    const age = Number(ageText);
    if (!isEligibleAge(age)) {
      throw new Error('Santulan is for people aged 13 to 25, so we cannot register you right now. If you are unsure, please talk to someone you trust or visit the Support page.');
    }
    if (!email.trim()) throw new Error('Please enter your email address.');
    if (password !== confirmPassword) throw new Error('The two passwords do not match.');
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error('Your password needs at least 10 characters, with letters and numbers.');
    const r = await api.routeAge(age);
    setRoute(r); setStep(2);
  });

  const createAccount = () => run(async () => {
    const res = await api.registerOpen(Number(ageText), undefined, email.trim(), password, idempotencyKey.current);
    signIn(res.accessToken);
    setResult(res); setStep(3);
  });

  const role = route ? (route.isMinor ? 'minor' : 'adult') : null;
  const back = (to) => { setError(''); setStep(to); };
  const eye = (
    <button type="button" className={styles.linkButton} style={{ textDecoration: 'none', minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
      {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  );

  return (
    <PublicLayout action="register" noFooter>
      <div className={s.split}>
        <ImageSlot slot={`registerStep${step}`} className={s.splitPhoto} />
        <div className={s.splitShade} aria-hidden="true" />
        <div className={`${s.splitInner} ${step === 3 ? s.splitInnerWide : ''}`.trim()}>
          <Message step={step} />

          <div className={s.authCard}>
            {step < 3 && (
              <div className={s.authTop}>
                {step === 1 && <p className={s.authEyebrow}>Open route registration</p>}
                {step === 2 && <button type="button" className={s.authBack} onClick={() => back(1)} disabled={busy}><ArrowLeft size={18} aria-hidden="true" />Back</button>}
                <StepIndicator current={step} labels={LABELS} />
              </div>
            )}
            {error && <div style={{ marginBottom: 'var(--sp-4)' }}><StatusMessage type="error" message={error} /></div>}

            {step === 1 && (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submitDetails(); }}>
                <div>
                  <h1 className={s.authTitle}>Create Your Account</h1>
                  <p className={s.authSub}>Tell us your age, and choose the email and password you&apos;ll sign in with.</p>
                </div>
                <Field size="lg" icon={UserRound} label="Age in years" type="number" inputMode="numeric" min="13" max="25" step="1" value={ageText} onChange={(e) => setAgeText(e.target.value)}
                  hint="Enter your age as a whole number." />
                <Field size="lg" icon={Mail} label="Email address" type="email" autoComplete="email" placeholder="yourname@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Field size="lg" icon={Lock} trailing={eye} label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  hint="At least 10 characters, with letters and numbers." />
                <Field size="lg" icon={Lock} label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <InfoNote icon={Info}>If you are below 18 years, we will guide you through an additional assent and parent/guardian consent process.</InfoNote>
                <Button type="submit" size="lg" block disabled={busy}>Continue <ArrowRight size={20} aria-hidden="true" /></Button>
                <InfoNote icon={Lock} tone="quiet">Your information is secure and used only for participation and support purposes.</InfoNote>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <ButtonLink to="/login" variant="secondary" size="lg" icon>I already have an account</ButtonLink>
              </form>
            )}

            {step === 2 && route && (
              <div className={s.authForm}>
                <div>
                  <h1 className={s.authTitle}>Consent and Participation</h1>
                  <p className={s.authSub}>Based on the age you entered, here is how you will take part.</p>
                </div>
                {/* Read-only: the age was already collected in step 1, so this states what it derives rather than
                    asking the participant to pick again (and possibly contradict their own answer). */}
                <section className={`${styles.card} ${route.isMinor ? styles.toneGreen : styles.toneBlue}`}>
                  <div className={styles.row} style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <IconBadge icon={route.isMinor ? Users : UserRound} tone={route.isMinor ? 'green' : 'blue'} />
                    <div>
                      <p className={styles.h4} style={{ margin: '0 0 4px' }}>{route.isMinor ? 'Below 18 years' : '18 years or older'}</p>
                      <p style={{ margin: '0 0 8px' }}>
                        {route.isMinor ? 'You will need assent and your parent/guardian’s consent to participate.' : 'You can provide your own consent to participate in Santulan.'}
                      </p>
                      <span className={`${styles.pill} ${route.isMinor ? styles.pillGreen : ''}`.trim()}>{route.isMinor ? 'Assent + Parent/Guardian Consent' : 'Self-Consent'}</span>
                    </div>
                  </div>
                </section>
                {route.requiredConsents.map((c) => (
                  <section key={c} className={`${styles.card} ${styles.toneBlue}`}>
                    <span className={styles.pill}>{CONSENT_CARDS[c].tag}</span>
                    <h2 className={styles.h3} style={{ marginTop: 'var(--sp-2)' }}>{CONSENT_CARDS[c].title}</h2>
                    <p style={{ margin: 0 }}>{CONSENT_CARDS[c].text}</p>
                    {c !== 'STUDENT_ASSENT' && (
                      <Button variant="secondary" size="sm" onClick={() => setConsentModalKey(c)} style={{ marginTop: 'var(--sp-3)' }}>
                        {agreedConsents[c] ? <><Check size={16} aria-hidden="true" />Consent form reviewed</> : 'Read consent form'}
                      </Button>
                    )}
                  </section>
                ))}
                <InfoNote icon={Info}>Honest information helps us ensure the right support and a safe experience for all participants.</InfoNote>
                <Button size="lg" block onClick={createAccount} disabled={busy || !route.requiredConsents.filter((c) => c !== 'STUDENT_ASSENT').every((c) => agreedConsents[c])}>Create my account <ArrowRight size={20} aria-hidden="true" /></Button>
                <InfoNote icon={Lock} tone="quiet">Your information is secure and used only for participation and support purposes.</InfoNote>
              </div>
            )}

            {step === 3 && result && (
              <div className={s.authForm}>
                <span className={s.successMark} aria-hidden="true"><Check size={48} strokeWidth={2.5} /></span>
                <p className={s.successEyebrow}>Registration successful</p>
                <h1 className={`${s.authTitle} ${s.centerText}`}>Welcome to Santulan!</h1>
                <p className={`${s.authSub} ${s.centerText}`}>You&apos;re now part of a community that believes in understanding, growth and a brighter tomorrow.</p>
                <CopyField label="Your Santulan ID" value={result.santulanId} hint="Keep this for your records - you can sign in with your email and password instead." />
                <StatusMessage type="info" message={result.isMinor
                  ? 'You are signed in. We will wait for consent to be verified, including your parent or guardian, before you can start.'
                  : 'You are signed in. Your consent needs to be verified before you can start.'} />
                <Button size="lg" block onClick={() => navigate('/student/validation-profile')}>Go to Dashboard <ArrowRight size={20} aria-hidden="true" /></Button>
              </div>
            )}
          </div>
        </div>
      </div>
      <ConsentFormModal
        open={!!consentModalKey}
        role={role}
        onClose={() => setConsentModalKey(null)}
        onAgree={() => { setAgreedConsents((prev) => ({ ...prev, [consentModalKey]: true })); setConsentModalKey(null); }}
      />
    </PublicLayout>
  );
}

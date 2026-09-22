/*
 * Five-step registration wizard (screens 04-08), reconciled with the canonical rules (spec 005, decision D-01):
 *   1 email / mobile   2 one-time code   3 AGE IN YEARS (no date of birth anywhere)   4 consent derived from age   5 Santulan ID
 * The age is the only personal value sent to the server; the opaque Santulan ID comes back from it. Consent records are created
 * and verified by the privileged consent service, so step 5 reports their real status instead of pretending they are done.
 * Layout: a picture area on the left (an ImageSlot, white until a path is set) with the step's message, and the form card on the
 * right; below 1080 px the message shortens and below 640 px only the picture strip and the card remain.
 * Copy is placeholder text flagged TODO(copy).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Info, Leaf, Lock, Mail, ShieldCheck, Smartphone, UserRound, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import s from '../../styles/site.module.css';
import { PublicLayout } from '../../components/layouts';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { StepIndicator, OtpInput, CopyField, ChoiceCard, IconBadge, InfoNote, ButtonLink } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api, newKey } from '../../services/santulanApi';
import { useSession } from '../../services/SessionContext';

const LABELS = ['Contact', 'Verify', 'Age', 'Consent', 'Done'];
const RESEND_SECONDS = 30;

const CONSENT_CARDS = {
  PARENT_GUARDIAN_CONSENT: { title: 'Parent or guardian consent', tag: 'Parent / guardian', text: 'A parent or guardian confirms that you may take part. TODO(copy): approved consent text is supplied by the programme owner.' },
  STUDENT_ASSENT: { title: 'Your assent', tag: 'Self', text: 'You confirm that you are happy to take part. TODO(copy): approved assent text is supplied by the programme owner.' },
  ADULT_SELF_CONSENT: { title: 'Your consent', tag: 'Self-consent', text: 'You confirm that you are happy to take part. TODO(copy): approved consent text is supplied by the programme owner.' },
};

const isEligibleAge = (n) => Number.isInteger(n) && n >= 13 && n <= 25;

/** The message on the left of each step (samples 04-08). */
const HERO = {
  1: {
    title: 'Your Journey Begins Here',
    lead: 'Take the first step towards understanding yourself better. Register as an individual to access the Santulan well-being assessment and development platform.',
    features: [[UserRound, 'green', 'Simple Registration', 'Just your email or mobile number'], [ShieldCheck, 'blue', 'Safe & Confidential', 'Your information is secure with us'], [Leaf, 'lavender', 'A Brighter Tomorrow', 'Understand, grow and thrive']],
    script: 'Same You. A Brighter Tomorrow.',
  },
  2: { title: 'One More Step Closer', quote: 'Small steps today, a brighter tomorrow.', triad: true },
  3: {
    title: 'Your Age Helps Us Support You Better',
    lead: 'Santulan is designed for adolescents and emerging adults. Please tell us your age so we can ensure the right guidance, consent process and support.',
    features: [[ShieldCheck, 'blue', 'Age-appropriate experience', 'Content and support suited to your age'], [Users, 'green', 'Additional consent where needed', 'For participants below 18 years'], [Lock, 'lavender', 'Your information is safe', 'We respect and protect your privacy']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
  4: {
    title: 'Consent Creates a Safer Space',
    lead: 'Santulan values your well-being and follows age-appropriate consent processes. This helps ensure a safe, supportive and responsible experience for everyone.',
    features: [[ShieldCheck, 'blue', 'Your Safety Matters', 'Age-appropriate consent for a secure experience'], [Users, 'green', 'Support from Parents/Guardians', 'For participants below 18 years'], [Lock, 'lavender', 'Your Information Stays Private', 'We respect your privacy']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
  5: {
    title: 'Your Account is Ready!',
    lead: 'You have successfully registered for Santulan. Here is your Santulan ID. Please keep it safe for future sign-ins.',
    features: [[Check, 'blue', 'Keep it safe', 'You will need this ID to sign in'], [ShieldCheck, 'green', 'Your data is secure', 'Your information is used only for participation and support'], [Leaf, 'lavender', 'Next step', 'Your consent is verified, then you can begin']],
    script: 'Different Journeys. A Brighter Tomorrow.',
  },
};

function Message({ step, identity }) {
  const h = HERO[step];
  return (
    <div className={s.splitCopy}>
      {step > 1 && <p className={s.splitEyebrow}>Open route registration</p>}
      <p className={s.splitTitle}>{h.title}</p>
      {step === 2 ? (
        <>
          <p className={s.splitLead}>We&apos;ve sent a verification code to <strong>{identity}</strong>. Please enter the code below to verify your account.</p>
          <blockquote className={s.splitQuote}>“{h.quote}”</blockquote>
          <p className={s.splitTriad}>Understand · Grow · Thrive</p>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [step, setStep] = useState(1);
  const [channel, setChannel] = useState('email');
  const [identity, setIdentity] = useState('');
  const [thirteenPlus, setThirteenPlus] = useState(false);
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [registrationToken, setRegistrationToken] = useState(null);
  const [ageText, setAgeText] = useState('');
  const [route, setRoute] = useState(null);
  const [choice, setChoice] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newKey('reg'));         // one key per registration attempt, reused on every retry

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const t = setTimeout(() => setSeconds((sec) => sec - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const run = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const sendCode = () => run(async () => {
    if (!identity.trim()) throw new Error(channel === 'email' ? 'Please enter your email address.' : 'Please enter your mobile number.');
    if (!thirteenPlus) throw new Error('Please confirm that you are 13 years or older.');
    await api.requestOtp(channel, identity.trim());
    setSeconds(RESEND_SECONDS); setCode(''); setStep(2);
  });

  const verify = () => run(async () => {
    if (code.length !== 6) throw new Error('Please enter the 6-digit code.');
    const res = await api.verifyOtp(channel, identity.trim(), code);
    if (res.registered) { signIn(res.accessToken); navigate('/student', { replace: true }); return; }
    setRegistrationToken(res.registrationToken); setStep(3);
  });

  const submitAge = () => run(async () => {
    const age = Number(ageText);
    if (!isEligibleAge(age)) {
      throw new Error('Santulan is for people aged 13 to 25, so we cannot register you right now. If you are unsure, please talk to someone you trust or visit the Support page.');
    }
    const r = await api.routeAge(age);
    setRoute(r); setChoice(r.isMinor ? 'minor' : 'adult'); setStep(4);
  });

  const createAccount = () => run(async () => {
    const declared = route.isMinor ? 'minor' : 'adult';
    if (choice !== declared) throw new Error('That option does not match the age you entered. Please go back or choose the matching option.');
    const res = await api.declareAge(registrationToken, Number(ageText), idempotencyKey.current);
    signIn(res.accessToken); setResult(res); setStep(5);
  });

  const contradicts = route && choice && choice !== (route.isMinor ? 'minor' : 'adult');
  const back = (to) => { setError(''); setStep(to); };
  const ChannelIcon = channel === 'email' ? Mail : Smartphone;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <PublicLayout action="register">
      <div className={s.split}>
        <ImageSlot slot={`registerStep${step}`} className={s.splitPhoto} />
        <div className={s.splitShade} aria-hidden="true" />
        <div className={`${s.splitInner} ${step === 5 ? s.splitInnerWide : ''}`.trim()}>
          <Message step={step} identity={identity} />

          <div className={s.authCard}>
            {step < 5 && (
              <div className={s.authTop}>
                {step === 1 && <p className={s.authEyebrow}>Open route registration</p>}
                {step === 2 && <button type="button" className={s.authBack} onClick={() => back(1)} disabled={busy}><ArrowLeft size={18} aria-hidden="true" />Back</button>}
                {step === 4 && <button type="button" className={s.authBack} onClick={() => back(3)} disabled={busy}><ArrowLeft size={18} aria-hidden="true" />Back</button>}
                {step === 3 && <span />}
                <StepIndicator current={step} labels={LABELS} />
              </div>
            )}
            {error && <div style={{ marginBottom: 'var(--sp-4)' }}><StatusMessage type="error" message={error} /></div>}

            {step === 1 && (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
                <div>
                  <h1 className={s.authTitle}>Sign In or Register</h1>
                  <p className={s.authSub}>New here or coming back? Enter your email address or mobile number below either way.</p>
                </div>
                <div className={styles.segmented} role="tablist" aria-label="How should we verify you?">
                  {[['email', 'Email Address', Mail], ['mobile', 'Mobile Number', Smartphone]].map(([c, text, Icon]) => (
                    <button key={c} type="button" role="tab" aria-selected={channel === c} className={`${styles.segment} ${channel === c ? styles.segmentActive : ''}`} onClick={() => { setChannel(c); setIdentity(''); }}>
                      <Icon size={20} aria-hidden="true" />{text}
                    </button>
                  ))}
                </div>
                <Field size="lg" icon={ChannelIcon} label={channel === 'email' ? 'Email address' : 'Mobile number'} type={channel === 'email' ? 'email' : 'tel'} autoComplete={channel === 'email' ? 'email' : 'tel'}
                  placeholder={channel === 'email' ? 'yourname@example.com' : 'Your mobile number'} value={identity} onChange={(e) => setIdentity(e.target.value)}
                  hint={channel === 'email' ? 'We’ll send you a verification code to this email address.' : 'We’ll send you a verification code to this mobile number.'} />
                <label className={styles.check}>
                  <input type="checkbox" checked={thirteenPlus} onChange={(e) => setThirteenPlus(e.target.checked)} />
                  <span>I am 13 years or older</span>
                  <Info size={18} aria-hidden="true" style={{ color: 'var(--c-brand)' }} />
                </label>
                <Button type="submit" size="lg" block disabled={busy}>Send Verification Code <ArrowRight size={20} aria-hidden="true" /></Button>
                <p className={styles.muted} style={{ margin: 0 }}>
                  Already registered this way before? Enter the same email or mobile number above — we will recognise you
                  and sign you straight in, no need to register again.
                </p>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <ButtonLink to="/login" variant="secondary" size="lg" icon>I registered through a school or college</ButtonLink>
                <div className={`${styles.railCard} ${styles.toneSky}`}>
                  <IconBadge icon={Lock} tone="blue" size="sm" />
                  <div className={styles.railBody}>
                    <p className={styles.h4}>Your Privacy Matters</p>
                    <p>Your information is used only for your assessment and development. We do not share your data without permission.</p>
                    <Link className={styles.pageLink} to="/support">Learn More</Link>
                  </div>
                </div>
              </form>
            )}

            {step === 2 && (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); verify(); }}>
                <div>
                  <h1 className={s.authTitle}>Enter Verification Code</h1>
                  <p className={s.authSub}>We&apos;ve sent a 6-digit code to <strong>{identity}</strong></p>
                </div>
                <OtpInput value={code} onChange={setCode} disabled={busy} />
                <p className={s.resendRow}>
                  Didn&apos;t receive the code?{' '}
                  <button type="button" className={styles.linkButton} disabled={seconds > 0 || busy} onClick={sendCode}>
                    {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
                  </button>
                  {seconds > 0 && <span className={s.timer} aria-hidden="true"> {mm}:{ss}</span>}
                </p>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <Button variant="secondary" size="lg" block onClick={() => back(1)} disabled={busy}>{channel === 'email' ? 'Change Email Address' : 'Change Mobile Number'}</Button>
                <Button type="submit" size="lg" block disabled={busy}>Verify and Continue <ArrowRight size={20} aria-hidden="true" /></Button>
                <div className={`${styles.railCard} ${styles.toneSky}`}>
                  <IconBadge icon={ShieldCheck} tone="blue" size="sm" />
                  <div className={styles.railBody}>
                    <p className={styles.h4}>Your security matters</p>
                    <p>The verification code will expire in 10 minutes. Do not share this code with anyone.</p>
                  </div>
                </div>
              </form>
            )}

            {step === 3 && (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submitAge(); }}>
                <div>
                  <h1 className={s.authTitle}>Tell Us Your Age</h1>
                  <p className={s.authSub}>Please enter your age in years.</p>
                </div>
                <Field size="lg" icon={UserRound} label="Age in years" type="number" inputMode="numeric" min="13" max="25" step="1" value={ageText} onChange={(e) => setAgeText(e.target.value)}
                  hint="Enter your age as a whole number." />
                <InfoNote icon={Info}>If you are below 18 years, we will guide you through an additional assent and parent/guardian consent process.</InfoNote>
                <Button type="submit" size="lg" block disabled={busy}>Continue <ArrowRight size={20} aria-hidden="true" /></Button>
                <InfoNote icon={Lock} tone="quiet">Your information is secure and used only for participation and support purposes.</InfoNote>
              </form>
            )}

            {step === 4 && route && (
              <div className={s.authForm}>
                <div>
                  <h1 className={s.authTitle}>Consent and Participation</h1>
                  <p className={s.authSub}>Please select the option that applies to you.</p>
                </div>
                <div role="radiogroup" aria-label="Which applies to you?" className={styles.stack}>
                  <ChoiceCard name="consent-route" value="adult" checked={choice === 'adult'} onChange={() => setChoice('adult')} icon={UserRound} tone="blue"
                    title="I am 18 years or older" description="I can provide my own consent to participate in Santulan." tag="Self-Consent" />
                  <ChoiceCard name="consent-route" value="minor" checked={choice === 'minor'} onChange={() => setChoice('minor')} icon={Users} tone="green"
                    title="I am below 18 years" description="I will need assent and my parent/guardian’s consent to participate." tag="Assent + Parent/Guardian Consent" />
                </div>
                {contradicts && <StatusMessage type="warning" message="That option does not match the age you entered." />}
                {!contradicts && route.requiredConsents.map((c) => (
                  <section key={c} className={`${styles.card} ${styles.toneBlue}`}>
                    <span className={styles.pill}>{CONSENT_CARDS[c].tag}</span>
                    <h2 className={styles.h3} style={{ marginTop: 'var(--sp-2)' }}>{CONSENT_CARDS[c].title}</h2>
                    <p style={{ margin: 0 }}>{CONSENT_CARDS[c].text}</p>
                  </section>
                ))}
                <InfoNote icon={Info}>Honest information helps us ensure the right support and a safe experience for all participants.</InfoNote>
                <Button size="lg" block onClick={createAccount} disabled={busy || contradicts}>Create my account <ArrowRight size={20} aria-hidden="true" /></Button>
                <InfoNote icon={Lock} tone="quiet">Your information is secure and used only for participation and support purposes.</InfoNote>
              </div>
            )}

            {step === 5 && result && (
              <div className={s.authForm}>
                <span className={s.successMark} aria-hidden="true"><Check size={48} strokeWidth={2.5} /></span>
                <p className={s.successEyebrow}>Registration successful</p>
                <h1 className={`${s.authTitle} ${s.centerText}`}>Welcome to Santulan!</h1>
                <p className={`${s.authSub} ${s.centerText}`}>You&apos;re now part of a community that believes in understanding, growth and a brighter tomorrow.</p>
                <CopyField label="Your Santulan ID" value={result.santulanId} hint="You will need this ID to sign in to your account." />
                <StatusMessage type="info" message={result.isMinor
                  ? 'We are waiting for consent to be verified, including your parent or guardian. You can start once that is done.'
                  : 'Your consent needs to be verified before you can start.'} />
                <Button size="lg" block disabled aria-describedby="start-reason">Start assessment <ArrowRight size={20} aria-hidden="true" /></Button>
                <p id="start-reason" className={`${styles.muted} ${s.centerText}`} style={{ margin: 0 }}>The start button turns on when your consent has been verified.</p>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <Button variant="secondary" size="lg" block onClick={() => navigate('/student')}>Go to Dashboard <ArrowRight size={20} aria-hidden="true" /></Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

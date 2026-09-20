/*
 * Five-step registration wizard (screens 04-08), reconciled with the canonical rules (spec 005, decision D-01):
 *   1 email / mobile   2 one-time code   3 AGE IN YEARS (no date of birth anywhere)   4 consent derived from age   5 Santulan ID
 * The age is the only personal value sent to the server; the opaque Santulan ID comes back from it. Consent records are created
 * and verified by the privileged consent service, so step 5 reports their real status instead of pretending they are done.
 * Copy is placeholder text flagged TODO(copy).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import { PublicLayout } from '../../components/layouts';
import { StepIndicator, OtpInput, CopyField, RailCard, SelectableCard } from '../../components/participantKit';
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
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
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

  return (
    <PublicLayout>
      <div className={styles.floating}>
        <p className={styles.eyebrow}>Open route registration</p>
        <StepIndicator current={step} labels={LABELS} />
        {error && <StatusMessage type="error" message={error} />}

        {step === 1 && (
          <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
            <h1 className={styles.h3}>Let's get you started</h1>
            <div className={styles.tabs} role="tablist" aria-label="How should we verify you?">
              {['email', 'mobile'].map((c) => (
                <button key={c} type="button" role="tab" aria-selected={channel === c} className={`${styles.tab} ${channel === c ? styles.tabActive : ''}`} onClick={() => { setChannel(c); setIdentity(''); }}>
                  {c === 'email' ? 'Email' : 'Mobile'}
                </button>
              ))}
            </div>
            <Field label={channel === 'email' ? 'Email address' : 'Mobile number'} type={channel === 'email' ? 'email' : 'tel'} autoComplete={channel === 'email' ? 'email' : 'tel'}
              value={identity} onChange={(e) => setIdentity(e.target.value)} />
            <label className={styles.check}>
              <input type="checkbox" checked={thirteenPlus} onChange={(e) => setThirteenPlus(e.target.checked)} />
              <span>I am 13 years or older</span>
            </label>
            <Button type="submit" disabled={busy}>Send verification code</Button>
            <p className={styles.muted}>Already have an account? <Link className={styles.pageLink} to="/login">I already have an account</Link></p>
          </form>
        )}

        {step === 2 && (
          <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <h1 className={styles.h3}>Enter your code</h1>
            <p className={styles.muted}>We sent a 6-digit code to {identity}.</p>
            <OtpInput value={code} onChange={setCode} disabled={busy} />
            <div className={styles.row}>
              <Button type="submit" disabled={busy}>Verify</Button>
              <button type="button" className={styles.linkButton} disabled={seconds > 0 || busy} onClick={sendCode}>
                {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); submitAge(); }}>
            <h1 className={styles.h3}>How old are you?</h1>
            <Field label="Age in years" type="number" inputMode="numeric" min="13" max="25" step="1" value={ageText} onChange={(e) => setAgeText(e.target.value)}
              hint="Enter your age as a whole number." />
            <RailCard tone="sky" title="If you are under 18">
              <p>A parent or guardian will also need to give their consent before you can begin.</p>
            </RailCard>
            <Button type="submit" disabled={busy}>Continue</Button>
          </form>
        )}

        {step === 4 && route && (
          <div className={styles.stack}>
            <h1 className={styles.h3}>Consent</h1>
            <p className={styles.muted}>These are the consent steps that apply to you, based on the age you entered.</p>
            <div role="radiogroup" aria-label="Which applies to you?" className={styles.stack}>
              {[['minor', 'I am under 18'], ['adult', 'I am 18 or over']].map(([value, label]) => (
                <SelectableCard key={value} name="consent-route" value={value} checked={choice === value} onChange={() => setChoice(value)}>{label}</SelectableCard>
              ))}
            </div>
            {contradicts && <StatusMessage type="warning" message="That option does not match the age you entered." />}
            {!contradicts && route.requiredConsents.map((c) => (
              <section key={c} className={`${styles.card} ${styles.toneBlue}`}>
                <span className={styles.pill}>{CONSENT_CARDS[c].tag}</span>
                <h2 className={styles.h3}>{CONSENT_CARDS[c].title}</h2>
                <p>{CONSENT_CARDS[c].text}</p>
              </section>
            ))}
            <div className={styles.row}>
              <Button variant="secondary" onClick={() => setStep(3)} disabled={busy}>Back</Button>
              <Button onClick={createAccount} disabled={busy || contradicts}>Create my account</Button>
            </div>
          </div>
        )}

        {step === 5 && result && (
          <div className={styles.stack}>
            <h1 className={styles.h3}>You are registered</h1>
            <CopyField label="Your Santulan ID (keep it safe)" value={result.santulanId} />
            <StatusMessage type="info" message={result.isMinor
              ? 'We are waiting for consent to be verified, including your parent or guardian. You can start once that is done.'
              : 'Your consent needs to be verified before you can start.'} />
            <div className={styles.row}>
              <Button disabled aria-describedby="start-reason">Start assessment</Button>
              <Button variant="secondary" onClick={() => navigate('/student')}>Go to my dashboard</Button>
            </div>
            <p id="start-reason" className={styles.muted}>The start button turns on when your consent has been verified.</p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

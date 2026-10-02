/*
 * Sign-in (screen 09). One ID field that takes either a Santulan ID (institutional participants and admins) or an email
 * address (OPEN participants - they register with email + their own password, see RegisterPage.jsx, and the email IS
 * their login subject). A temporary password (institutional only - OPEN participants never get one) never opens a
 * session: the server answers `mustSetPassword` and this page moves to a set-password step; only after the new password
 * is set does a session exist. "Forgot your password?" self-service (email only, POST /auth/forgot-password) only
 * actually does anything for OPEN participants - the server silently no-ops for anyone else, same "never reveal"
 * pattern the old OTP request used; institutional participants still go through their coordinator.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, ChartColumn, Eye, EyeOff, Info, Landmark, Lock, ShieldCheck, UserRound, Users } from 'lucide-react';
import styles from '../styles/ui.module.css';
import s from '../styles/site.module.css';
import { PublicLayout } from '../components/layouts';
import ImageSlot from '../components/ImageSlot/ImageSlot';
import { IconBadge } from '../components/participantKit';
import Button from '../components/Button/Button';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import { api } from '../services/santulanApi';
import { useSession } from '../services/SessionContext';

const HOME_BY_ROLE = { participant: '/student', admin: '/admin' };

const FEATURES = [
  [Users, 'blue', 'For Schools & Colleges', 'Enable development support for your students'],
  [ChartColumn, 'green', 'Secure & Compliant', 'Role-based access with full data privacy'],
  [ShieldCheck, 'lavender', 'Meaningful Insights', 'Support student well-being and growth'],
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, session } = useSession();
  const [subject, setSubject] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [setToken, setSetToken] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session && HOME_BY_ROLE[session.role]) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  const enter = (token) => {
    signIn(token);
    const role = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
    navigate(HOME_BY_ROLE[role] || '/student', { replace: true });
  };
  const run = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); } };

  const submitLogin = () => run(async () => {
    if (!subject.trim() || !password) throw new Error('Please enter your Santulan ID or email, and your password.');
    const res = await api.login(subject.trim(), password);
    if (res.mustSetPassword) { setSetToken(res.setPasswordToken); setPassword(''); return; }
    enter(res.accessToken);
  });

  /** OPEN participants only (self-registered, no coordinator) - their email IS their login subject, so this reuses
   * whatever is typed in the ID field above. Always shows the same confirmation either way - the server never reveals
   * whether it matched anything (same pattern as the old OTP request). Institutional participants (who sign in with a
   * Santulan ID, not an email) still go through their coordinator; this quietly does nothing for them. */
  const submitForgot = () => run(async () => {
    const typed = subject.trim();
    // The ID field is shared with institutional (Santulan ID) sign-in; catch a non-email value here with a clear
    // message instead of letting the server's generic "Request validation failed" through (it validates email shape).
    if (!typed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) throw new Error('Please enter your email address (not a Santulan ID) in the field above, then try again.');
    await api.forgotPassword(typed);
    setForgotSent(true);
  });

  const submitNew = () => run(async () => {
    if (newPassword !== confirm) throw new Error('The two passwords do not match.');
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) throw new Error('Your new password needs at least 10 characters, with letters and numbers.');
    const res = await api.setPassword(setToken, newPassword);
    enter(res.accessToken);
  });

  const eye = (
    <button type="button" className={styles.linkButton} style={{ textDecoration: 'none', minWidth: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
      {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  );

  return (
    <PublicLayout action="register" noFooter>
      <div className={s.split}>
        <ImageSlot slot="loginHero" className={s.splitPhoto} />
        <div className={s.splitShade} aria-hidden="true" />
        <div className={`${s.splitInner} ${s.splitInnerWide}`}>
          <div className={s.splitCopy}>
            <p className={s.splitEyebrow}>Institutional access</p>
            <p className={s.splitTitle}>Partnering for Brighter Tomorrows</p>
            <p className={s.splitLead}>Santulan works with schools, colleges and organisations to support the holistic development of their students through an ethical and secure platform.</p>
            <ul className={s.splitFeatures}>
              {FEATURES.map(([Icon, tone, title, text]) => (
                <li key={title} className={s.splitFeature}>
                  <IconBadge icon={Icon} tone={tone} size="sm" />
                  <div><p className={s.splitFeatureTitle}>{title}</p><p className={s.splitFeatureText}>{text}</p></div>
                </li>
              ))}
            </ul>
          </div>

          <div className={s.authCard}>
            <p className={`${styles.muted} ${styles.rowBetween}`} style={{ justifyContent: 'flex-end', margin: '0 0 var(--sp-3)', gap: 'var(--sp-2)' }}>
              New here, not through a school? <Link className={styles.pageLink} to="/register">Register on your own</Link>
            </p>
            {error && <div style={{ marginBottom: 'var(--sp-4)' }}><StatusMessage type="error" message={error} /></div>}
            {!setToken ? (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submitLogin(); }}>
                <div>
                  <h1 className={s.authTitle}>Sign in</h1>
                  <p className={s.authSub}>Registered on your own? Use your email. Registered through a school or college? Use your Santulan ID.</p>
                </div>
                <Field size="lg" icon={UserRound} label="Santulan ID or email" name="subject" autoComplete="username" placeholder="Your Santulan ID or email address" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Field size="lg" icon={Lock} trailing={eye} label="Password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className={`${styles.linkButton} ${s.forgot}`} aria-expanded={showForgot} onClick={() => { setShowForgot((v) => !v); setForgotSent(false); }} style={{ textDecoration: 'none' }}>Forgot your password?</button>
                {showForgot && (
                  forgotSent ? (
                    <StatusMessage type="info" message="If that's a self-registered account's email, we've sent a reset link to it. If you registered through a school or college instead, please ask your coordinator to issue a new temporary password." />
                  ) : (
                    <div className={styles.stack} style={{ gap: 'var(--sp-2)' }}>
                      <p className={styles.muted} style={{ margin: 0 }}>Self-registered (not through a school)? Enter your email address above, then click below and we'll send a reset link.</p>
                      <Button type="button" variant="secondary" size="md" onClick={submitForgot} disabled={busy}>Send reset link</Button>
                      <p className={styles.muted} style={{ margin: 0 }}>Registered through a school or college instead? Please ask your coordinator to issue a new temporary password.</p>
                    </div>
                  )
                )}
                <Button type="submit" size="lg" block disabled={busy}>Sign In <ArrowRight size={20} aria-hidden="true" /></Button>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <Button type="submit" variant="secondary" size="lg" block disabled={busy}><Landmark size={20} aria-hidden="true" /> Institution Login with Temporary Password <ArrowRight size={20} aria-hidden="true" /></Button>
                <div className={`${styles.railCard} ${styles.toneSky}`}>
                  <IconBadge icon={Info} tone="blue" size="sm" />
                  <div className={styles.railBody}>
                    <p className={styles.h4}>First time here?</p>
                    <p>Received a temporary password from your institution? Enter your Santulan ID and that temporary password above, then use the institution button to set your own password. If you registered on your own, sign in with the email and password you chose on the registration page.</p>
                  </div>
                </div>
              </form>
            ) : (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submitNew(); }}>
                <div>
                  <h1 className={s.authTitle}>Choose your own password</h1>
                  <p className={s.authSub}>Your temporary password can only be used once. Please choose a password that only you know.</p>
                </div>
                <Field size="lg" icon={Lock} label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint="At least 10 characters, with letters and numbers." />
                <Field size="lg" icon={Lock} label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button type="submit" size="lg" block disabled={busy}>Save password and continue <ArrowRight size={20} aria-hidden="true" /></Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

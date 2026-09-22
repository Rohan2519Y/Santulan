/*
 * Sign-in (screen 09). Santulan ID + password. A temporary password never opens a session: the server answers
 * `mustSetPassword` and this page moves to a set-password step; only after the new password is set does a session exist.
 * The ID placeholder is an opaque example - never a school or college code. There is no self-service password reset: the
 * "Forgot your password?" control explains that a coordinator issues a new temporary password.
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
    if (!subject.trim() || !password) throw new Error('Please enter your Santulan ID and password.');
    const res = await api.login(subject.trim(), password);
    if (res.mustSetPassword) { setSetToken(res.setPasswordToken); setPassword(''); return; }
    enter(res.accessToken);
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
    <PublicLayout action="register">
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
              Registered on your own, not through a school? <Link className={styles.pageLink} to="/register">Sign in with a code instead</Link>
            </p>
            {error && <div style={{ marginBottom: 'var(--sp-4)' }}><StatusMessage type="error" message={error} /></div>}
            {!setToken ? (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submitLogin(); }}>
                <div>
                  <h1 className={s.authTitle}>Sign in</h1>
                  <p className={s.authSub}>Sign in using your Santulan ID.</p>
                </div>
                <Field size="lg" icon={UserRound} label="Santulan ID" name="subject" autoComplete="username" placeholder="Enter your Santulan ID (e.g., STN-XXXXXXXXXXXXXXXXXXXX)" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Field size="lg" icon={Lock} trailing={eye} label="Password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className={`${styles.linkButton} ${s.forgot}`} aria-expanded={showForgot} onClick={() => setShowForgot((v) => !v)} style={{ textDecoration: 'none' }}>Forgot your password?</button>
                {showForgot && <StatusMessage type="info" message="Please ask your coordinator to issue a new temporary password." />}
                <Button type="submit" size="lg" block disabled={busy}>Sign In <ArrowRight size={20} aria-hidden="true" /></Button>
                <div className={s.orRule} aria-hidden="true">OR</div>
                <Button type="submit" variant="secondary" size="lg" block disabled={busy}><Landmark size={20} aria-hidden="true" /> Login with Temporary Password <ArrowRight size={20} aria-hidden="true" /></Button>
                <div className={`${styles.railCard} ${styles.toneSky}`}>
                  <IconBadge icon={Info} tone="blue" size="sm" />
                  <div className={styles.railBody}>
                    <p className={styles.h4}>First time here?</p>
                    <p>If you have received a temporary password from your institution, use the option above to set your new password. If you registered on your own, sign in with the code we send you on the registration page.</p>
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

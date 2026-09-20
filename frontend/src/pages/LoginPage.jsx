/*
 * Sign-in (screen 09). Santulan ID + password. A temporary password never opens a session: the server answers
 * `mustSetPassword` and this page moves to a set-password step; only after the new password is set does a session exist.
 * The ID placeholder is an opaque example - never a school or college code.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import styles from '../styles/ui.module.css';
import { PublicLayout } from '../components/layouts';
import { RailCard } from '../components/participantKit';
import Button from '../components/Button/Button';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import { api } from '../services/santulanApi';
import { useSession } from '../services/SessionContext';

const HOME_BY_ROLE = { participant: '/student', admin: '/admin' };

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, session } = useSession();
  const [subject, setSubject] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <PublicLayout>
      <div className={styles.floating}>
        <p className={`${styles.eyebrow} ${styles.eyebrowInstitution}`}>Sign in</p>
        {error && <StatusMessage type="error" message={error} />}
        {!setToken ? (
          <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); submitLogin(); }}>
            <h1 className={styles.h3}>Welcome back</h1>
            <Field label="Santulan ID" name="subject" autoComplete="username" placeholder="STN-XXXXXXXXXXXXXXXXXXXX" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Field label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              hint="First time here? Use the temporary password you were given, then choose your own." />
            <Button type="submit" disabled={busy}>Sign in</Button>
            <Button type="submit" variant="secondary" disabled={busy}>Login with Temporary Password</Button>
            <p className={styles.muted}>Forgot your password? Please ask your coordinator to issue a new temporary password.</p>
            <p className={styles.muted}>New to Santulan? <Link className={styles.pageLink} to="/get-started">Get started</Link></p>
          </form>
        ) : (
          <form className={styles.stack} onSubmit={(e) => { e.preventDefault(); submitNew(); }}>
            <h1 className={styles.h3}>Choose your own password</h1>
            <p className={styles.muted}>Your temporary password can only be used once. Please choose a password that only you know.</p>
            <Field label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint="At least 10 characters, with letters and numbers." />
            <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" disabled={busy}>Save password and continue</Button>
          </form>
        )}
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <RailCard tone="sky" title="First time here?">
            <p>Your school or college gives you a Santulan ID and a temporary password. If you registered on your own, sign in with the code we send you on the registration page.</p>
          </RailCard>
        </div>
      </div>
    </PublicLayout>
  );
}

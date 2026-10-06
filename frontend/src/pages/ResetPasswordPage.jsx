/*
 * Reset password: the page the "Reset your Santulan password" email links to (/reset-password?token=...). The token in the link is
 * the same short-lived set-password token a forced password change already uses, so it is sent to the same endpoint
 * (POST /auth/set-password). On success the server signs the person in, exactly as after a first-time password change.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import styles from '../styles/ui.module.css';
import s from '../styles/site.module.css';
import { PublicLayout } from '../components/layouts';
import ImageSlot from '../components/ImageSlot/ImageSlot';
import Button from '../components/Button/Button';
import Field from '../components/Field/Field';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import { api } from '../services/santulanApi';
import { useSession } from '../services/SessionContext';

const HOME_BY_ROLE = { participant: '/student', admin: '/admin' };

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { signIn, session } = useSession();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session && HOME_BY_ROLE[session.role]) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  const submit = async () => {
    setError('');
    if (newPassword !== confirm) { setError('The two passwords do not match.'); return; }
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) { setError('Your new password needs at least 10 characters, with letters and numbers.'); return; }
    setBusy(true);
    try {
      const res = await api.setPassword(token, newPassword);
      signIn(res.accessToken);
      const role = JSON.parse(atob(res.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
      navigate(HOME_BY_ROLE[role] || '/student', { replace: true });
    } catch (err) {
      setError(err.status === 401 || err.status === 403 || err.code === 'UNAUTHENTICATED' ? 'This reset link has expired or was already used. Please ask for a new one from the sign-in page.' : err.message);
    } finally { setBusy(false); }
  };

  return (
    <PublicLayout action="register" noFooter>
      <div className={`${s.split} ${s.resetSplit}`}>
        <ImageSlot slot="forgotPasswordHero" className={s.splitPhoto} />
        <div className={s.splitShade} aria-hidden="true" />
        <p className={s.resetQuote}>There is always a way forward.</p>
        <div className={`${s.splitInner} ${s.resetInner}`}>
          <div className={`${s.authCard} ${s.resetCard}`}>
            {!token ? (
              <>
                <StatusMessage type="error" message="This reset link is not complete. Please use the link from your email, or ask for a new one from the sign-in page." />
                <p className={styles.muted} style={{ marginTop: 'var(--sp-4)' }}><Link className={styles.pageLink} to="/login">Back to sign in</Link></p>
              </>
            ) : (
              <form className={s.authForm} onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <div>
                  <h1 className={s.authTitle}>Choose a new password</h1>
                  <p className={s.authSub}>Pick a password that only you know. The link in your email works once and for 15 minutes.</p>
                </div>
                {error && <StatusMessage type="error" message={error} />}
                <Field size="lg" icon={Lock} label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint="At least 10 characters, with letters and numbers." />
                <Field size="lg" icon={Lock} label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <Button type="submit" size="lg" block disabled={busy}>Save password and sign in <ArrowRight size={20} aria-hidden="true" /></Button>
                <p className={styles.muted}><Link className={styles.pageLink} to="/login">Back to sign in</Link></p>
              </form>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

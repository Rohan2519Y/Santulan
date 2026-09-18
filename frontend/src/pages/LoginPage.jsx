import { useState } from 'react';
import { login } from '../services/assessmentApi';
import Card from '../components/Card/Card';
import Field from '../components/Field/Field';
import Button from '../components/Button/Button';
import StatusMessage from '../components/StatusMessage/StatusMessage';
import styles from './LoginPage.module.css';

export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await login(email, password);
      onLoggedIn(user.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Santulan</h1>
        <p className="sr-only">A calm, self-paced capability check-in.</p>
      </div>
      <Card className={styles.card}>
        <form onSubmit={handleSubmit}>
          <Field label="Email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <StatusMessage type="error" message="Login failed – check your details" />}
          <Button type="submit" variant="primary" disabled={submitting} className={styles.submit}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

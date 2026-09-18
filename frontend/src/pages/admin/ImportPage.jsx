import { useState } from 'react';
import { importItemPool, controlParticipation } from '../../services/assessmentApi';
import Card from '../../components/Card/Card';
import Field from '../../components/Field/Field';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import styles from './ImportPage.module.css';

export default function ImportPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [controlMessage, setControlMessage] = useState(null);
  const [reason, setReason] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const res = await importItemPool(file);
      setResult(res.version);
    } catch (err) {
      setError({ message: err.message, details: err.details });
    }
  };

  const handleControl = async (action) => {
    setControlMessage(null);
    try {
      const res = await controlParticipation({ action, reason: reason || undefined });
      setControlMessage({ action: res.control.action, at: res.control.createdAt });
    } catch (err) {
      setControlMessage({ error: err.message });
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.section}>
        <h2 className={styles.title}>Import item pool</h2>
        <Field label="Item pool file" name="file" type="file" accept=".xlsx" onChange={handleFileChange} />
        {result && (
          <StatusMessage
            type="success"
            message={`Import complete — ${result.versionLabel} · ${result.itemCount} items · active = ${String(result.active)}`}
          />
        )}
        {error && (
          <StatusMessage type="error" message={error.message}>
            {error.details?.errors && (
              <ul className={styles.errorList}>
                {error.details.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}, {e.column}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </StatusMessage>
        )}
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.title}>Participation control</h2>
        <Field label="Reason (optional)" name="reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className={styles.controlActions}>
          <Button type="button" variant="secondary" tone="success" onClick={() => handleControl('REOPEN')}>
            Reopen
          </Button>
          <Button type="button" variant="secondary" tone="warning" onClick={() => handleControl('PAUSE')}>
            Pause
          </Button>
          <Button type="button" variant="secondary" tone="error" onClick={() => handleControl('STOP')}>
            Stop
          </Button>
        </div>
        {controlMessage && !controlMessage.error && (
          <StatusMessage
            type={controlMessage.action === 'REOPEN' ? 'success' : 'warning'}
            message={`${controlMessage.action} recorded at ${new Date(controlMessage.at).toLocaleString()}`}
          />
        )}
        {controlMessage?.error && <StatusMessage type="error" message={controlMessage.error} />}
      </Card>
    </div>
  );
}

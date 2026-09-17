import { useState } from 'react';
import { importItemPool, controlParticipation } from '../../services/assessmentApi';

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
      setControlMessage(`${res.control.action} recorded at ${new Date(res.control.createdAt).toLocaleString()}`);
    } catch (err) {
      setControlMessage(err.message);
    }
  };

  return (
    <div className="page">
      <h2>Import item pool</h2>
      <input type="file" accept=".xlsx" onChange={handleFileChange} />
      {result && (
        <p>
          Accepted: {result.versionLabel} — {result.itemCount} items, active = {String(result.active)}
        </p>
      )}
      {error && (
        <div className="error-text">
          <p>{error.message}</p>
          {error.details?.errors && (
            <ul>
              {error.details.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  Row {e.row}, {e.column}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h2>Participation control</h2>
      <label>
        Reason (optional)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="attempt-actions">
        <button type="button" onClick={() => handleControl('PAUSE')}>
          Pause
        </button>
        <button type="button" onClick={() => handleControl('STOP')}>
          Stop
        </button>
        <button type="button" onClick={() => handleControl('REOPEN')}>
          Reopen
        </button>
      </div>
      {controlMessage && <p>{controlMessage}</p>}
    </div>
  );
}

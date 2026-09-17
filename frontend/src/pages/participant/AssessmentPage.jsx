import { useEffect, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  getProfile,
  declareProfile,
  recordConsent,
  startOrResumeAttempt,
  saveResponse,
  pauseAttempt,
  resumeAttempt,
  submitAttempt,
} from '../../services/assessmentApi';

const ANCHOR_ORDER = [1, 2, 3, 4, 5];

function ProfileForm({ onDone }) {
  const [age, setAge] = useState(15);
  const [participationRoute, setParticipationRoute] = useState('OPEN');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { profile } = await declareProfile({ age: Number(age), participationRoute });
      onDone(profile);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={submit} className="profile-form">
      <h2>Before you begin</h2>
      <label>
        Age
        <input type="number" min="13" max="25" value={age} onChange={(e) => setAge(e.target.value)} required />
      </label>
      <label>
        Participation
        <select value={participationRoute} onChange={(e) => setParticipationRoute(e.target.value)}>
          <option value="OPEN">Open (individual)</option>
          <option value="INSTITUTIONAL">Institutional (school/college)</option>
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
      <button type="submit">Continue</button>
    </form>
  );
}

function ConsentForm({ profile, onDone }) {
  const [error, setError] = useState(null);
  const [granted, setGranted] = useState({});

  const grant = async (consentType, extra = {}) => {
    setError(null);
    try {
      await recordConsent({ consentType, protocolVersion: 'v1', ...extra });
      setGranted((g) => ({ ...g, [consentType]: true }));
    } catch (err) {
      setError(err.message);
    }
  };

  const tryProceed = async () => {
    setError(null);
    try {
      await onDone();
    } catch (err) {
      if (err.code === 'CONSENT_INCOMPLETE') {
        setError(`Still needed: ${err.details?.requiredConsents?.join(', ')}`);
      } else {
        setError(err.message);
      }
    }
  };

  return (
    <div className="consent-form">
      <h2>Consent</h2>
      {profile.isMinor ? (
        <>
          <p>As a minor participant, we need verified parent/guardian consent and your assent.</p>
          <button type="button" disabled={granted.PARENT_GUARDIAN_CONSENT} onClick={() => grant('PARENT_GUARDIAN_CONSENT', { verificationMethod: 'otp-to-parent-contact' })}>
            {granted.PARENT_GUARDIAN_CONSENT ? 'Parent/guardian consent recorded ✓' : 'Record parent/guardian consent'}
          </button>
          <button type="button" disabled={granted.STUDENT_ASSENT} onClick={() => grant('STUDENT_ASSENT')}>
            {granted.STUDENT_ASSENT ? 'Your assent recorded ✓' : 'Record your assent'}
          </button>
        </>
      ) : (
        <button type="button" disabled={granted.ADULT_SELF_CONSENT} onClick={() => grant('ADULT_SELF_CONSENT')}>
          {granted.ADULT_SELF_CONSENT ? 'Consent recorded ✓' : 'Give consent'}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="button" onClick={tryProceed}>
        Continue
      </button>
    </div>
  );
}

function AttemptView({ attempt, onSubmitted }) {
  const [current, setCurrent] = useState(attempt);
  const [answers, setAnswers] = useState(() => {
    const map = {};
    for (const a of attempt.savedAnswers || []) map[a.itemId] = a.value;
    return map;
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const answer = async (itemId, value) => {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    try {
      await saveResponse(current.id, { itemId, value, idempotencyKey: uuidv4() });
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePause = async () => {
    await pauseAttempt(current.id);
    setCurrent((c) => ({ ...c, status: 'PAUSED' }));
  };

  const handleResume = async () => {
    setError(null);
    try {
      const { attempt: resumed } = await resumeAttempt(current.id);
      setCurrent(resumed);
    } catch (err) {
      if (err.code === 'SESSION_LIMIT') {
        setError('You have used all 4 available sessions for this assessment. Please contact support to continue.');
      } else {
        setError(err.message);
      }
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitAttempt(current.id);
      onSubmitted(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const totalItems = current.sections.reduce((sum, s) => sum + s.items.length, 0);
  const answeredCount = Object.keys(answers).length;

  if (current.status === 'PAUSED') {
    return (
      <div className="attempt-paused">
        <p>
          Progress saved: {answeredCount} of {totalItems} answered. Session {current.sessionCount} of 4.
        </p>
        {error && <p className="error-text">{error}</p>}
        <button type="button" onClick={handleResume}>
          Continue Assessment
        </button>
      </div>
    );
  }

  return (
    <div className="attempt-view">
      <p className="progress-line">
        {answeredCount} of {totalItems} answered · Session {current.sessionCount} of 4
      </p>
      {current.sections.map((section) => (
        <section key={section.domainCode} className="domain-section">
          <h3>{section.domainName}</h3>
          {section.items.map((item) => (
            <fieldset key={item.id} className="item-row">
              <legend>{item.text}</legend>
              <div className="scale-row">
                {ANCHOR_ORDER.map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={item.id}
                      checked={answers[item.id] === value}
                      onChange={() => answer(item.id, value)}
                    />
                    {current.scale.anchors[String(value)]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      ))}
      {error && <p className="error-text">{error}</p>}
      <div className="attempt-actions">
        <button type="button" onClick={handlePause}>
          Pause
        </button>
        <button type="button" onClick={handleSubmit} disabled={submitting || answeredCount < totalItems}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

export default function AssessmentPage({ onSubmitted }) {
  const [stage, setStage] = useState('loading');
  const [profile, setProfile] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    try {
      const { profile: p } = await getProfile();
      setProfile(p);
      setStage('consent');
    } catch (err) {
      if (err.code === 'PROFILE_NOT_DECLARED') {
        setStage('profile');
      } else {
        setError(err.message);
      }
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const startAttempt = async () => {
    const { attempt: a } = await startOrResumeAttempt();
    setAttempt(a);
    setStage('attempt');
  };

  if (stage === 'loading') return <p>Loading…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (stage === 'profile') {
    return (
      <ProfileForm
        onDone={(p) => {
          setProfile(p);
          setStage('consent');
        }}
      />
    );
  }
  if (stage === 'consent') {
    return <ConsentForm profile={profile} onDone={startAttempt} />;
  }
  if (stage === 'attempt' && attempt) {
    return <AttemptView attempt={attempt} onSubmitted={onSubmitted} />;
  }
  return null;
}

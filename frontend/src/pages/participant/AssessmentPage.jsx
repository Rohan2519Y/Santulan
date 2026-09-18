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
import Card from '../../components/Card/Card';
import Field from '../../components/Field/Field';
import Button from '../../components/Button/Button';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import ProgressSummary from '../../components/ProgressSummary/ProgressSummary';
import ResponseScale from '../../components/ResponseScale/ResponseScale';
import Skeleton from '../../components/Skeleton/Skeleton';
import styles from './AssessmentPage.module.css';

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
    <Card as="form" onSubmit={submit} className={styles.stepCard}>
      <h2 className={styles.stepTitle}>Before you begin</h2>
      <Field label="Age" name="age" type="number" min="13" max="25" value={age} onChange={(e) => setAge(e.target.value)} required />
      <Field label="Participation" name="participationRoute" as="select" value={participationRoute} onChange={(e) => setParticipationRoute(e.target.value)}>
        <option value="OPEN">Open (individual)</option>
        <option value="INSTITUTIONAL">Institutional (school/college)</option>
      </Field>
      {error && <StatusMessage type="error" message={error} />}
      <Button type="submit" variant="primary" className={styles.stepAction}>
        Continue
      </Button>
    </Card>
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
    <Card className={styles.stepCard}>
      <h2 className={styles.stepTitle}>Consent</h2>
      {profile.isMinor ? (
        <>
          <p className={styles.stepCopy}>As a minor participant, we need verified parent/guardian consent and your assent.</p>
          <div className={styles.consentActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={granted.PARENT_GUARDIAN_CONSENT}
              onClick={() => grant('PARENT_GUARDIAN_CONSENT', { verificationMethod: 'otp-to-parent-contact' })}
            >
              {granted.PARENT_GUARDIAN_CONSENT ? 'Parent/guardian consent recorded ✓' : 'Record parent/guardian consent'}
            </Button>
            <Button type="button" variant="secondary" disabled={granted.STUDENT_ASSENT} onClick={() => grant('STUDENT_ASSENT')}>
              {granted.STUDENT_ASSENT ? 'Your assent recorded ✓' : 'Record your assent'}
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="secondary" disabled={granted.ADULT_SELF_CONSENT} onClick={() => grant('ADULT_SELF_CONSENT')}>
          {granted.ADULT_SELF_CONSENT ? 'Consent recorded ✓' : 'Give consent'}
        </Button>
      )}
      {error && <StatusMessage type="warning" message={error} />}
      <Button type="button" variant="primary" onClick={tryProceed} className={styles.stepAction}>
        Continue
      </Button>
    </Card>
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
  const currentDomain = current.sections.find((s) => s.items.some((i) => answers[i.id] == null)) || current.sections[current.sections.length - 1];

  if (current.status === 'PAUSED') {
    return (
      <Card className={styles.pausedCard}>
        <StatusMessage
          type="info"
          message={`Paused – resume when you're ready. ${answeredCount} of ${totalItems} answered, session ${current.sessionCount} of 4.`}
        />
        {error && <StatusMessage type="warning" message={error} />}
        <Button type="button" variant="primary" onClick={handleResume} className={styles.stepAction}>
          Continue Assessment
        </Button>
      </Card>
    );
  }

  return (
    <div className={styles.attempt}>
      <ProgressSummary
        answered={answeredCount}
        total={totalItems}
        domainName={currentDomain?.domainName}
        sessionCount={current.sessionCount}
      />
      {current.sections.map((section) => (
        <Card key={section.domainCode} className={styles.domainSection}>
          <h3 className={styles.domainTitle}>{section.domainName}</h3>
          {section.items.map((item) => (
            <fieldset key={item.id} className={styles.itemRow}>
              <legend className={styles.itemText}>{item.text}</legend>
              <ResponseScale
                anchors={current.scale.anchors}
                value={answers[item.id] ?? null}
                onChange={(value) => answer(item.id, value)}
                name={item.id}
                label={item.text}
              />
            </fieldset>
          ))}
        </Card>
      ))}
      {error && <StatusMessage type="error" message={error} />}
      <div className={styles.attemptActions}>
        <Button type="button" variant="secondary" onClick={handlePause}>
          Pause
        </Button>
        <Button type="button" variant="primary" onClick={handleSubmit} disabled={submitting || answeredCount < totalItems}>
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}

function LoadingCard() {
  return (
    <Card aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <Skeleton height={24} width="60%" className={styles.skeletonGap} />
      <Skeleton height={48} className={styles.skeletonGap} />
      <Skeleton height={48} width="40%" />
    </Card>
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

  if (stage === 'loading') return <LoadingCard />;
  if (error) return <StatusMessage type="error" message={error} />;
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

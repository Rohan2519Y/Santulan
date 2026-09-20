/*
 * The assessment player (screens 11-15 are REFERENCE only; the sample's four-section questionnaire and profile/consent steps
 * are NOT built - registration owns those). A hub of seven domain blocks, then one item at a time on the frozen 1-5 scale.
 *  - Answers are saved through a buffered queue: every logical write keeps ITS OWN idempotency key and is retried with that
 *    same key until the server acknowledges, so a lost reply never creates a second version.
 *  - Pause, session n of 4, last saved and one Continue action come from the server's resume model. No scores anywhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import Button from '../../components/Button/Button';
import ProgressSummary from '../../components/ProgressSummary/ProgressSummary';
import ResponseScale from '../../components/ResponseScale/ResponseScale';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api, newKey } from '../../services/santulanApi';

export const DOMAIN_NAMES = {
  C1: 'Body & Self-Regulation', C2: 'Emotional Capability', C3: 'Relational & Social Capability', C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency', C6: 'Adaptability & Resilience', C7: 'Self-Directed Learning & Executive Capability',
};
const RETRY_MS = 5000;

export default function AssessmentPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('loading');            // loading | hub | item | error
  const [error, setError] = useState('');
  const [attemptId, setAttemptId] = useState(null);
  const [model, setModel] = useState(null);
  const [items, setItems] = useState([]);
  const [anchors, setAnchors] = useState({});
  const [answers, setAnswers] = useState({});               // itemId -> value
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState('saved');      // saved | saving | retrying
  const [limitMessage, setLimitMessage] = useState('');
  const queue = useRef([]);
  const inFlight = useRef(null);
  const submitKey = useRef(null);

  const flush = useCallback(async (id) => {
    while (inFlight.current) await inFlight.current;              // never return while another flush is still writing
    if (!queue.current.length) return;
    const run = (async () => {
      while (queue.current.length) {
        setSaveState('saving');
        const next = queue.current[0];
        try {
          await api.saveResponse(id, next);
          queue.current.shift();
        } catch (err) {
          if (err.code === 'NETWORK_ERROR' || err.status >= 500) { setSaveState('retrying'); return; }   // keep it, same key, retry later
          queue.current.shift();
          setError(err.message);
        }
      }
      setSaveState('saved');
    })();
    inFlight.current = run;
    try { await run; } finally { inFlight.current = null; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await api.registrationState();
        if (!reg.attempt) { navigate('/student', { replace: true }); return; }
        const id = reg.attempt.attemptId;
        const m = await api.attempt(id);
        if (['SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'].includes(m.status)) { navigate('/student/generating', { replace: true }); return; }
        const [list, given] = await Promise.all([api.items(id), api.responses(id)]);
        if (cancelled) return;
        setAttemptId(id); setModel(m); setItems(list.items); setAnchors(list.scale.anchors);
        setAnswers(Object.fromEntries(given.responses.map((r) => [r.itemId, Number(r.value)])));
        setPhase('hub');
      } catch (err) { if (!cancelled) { setError(err.message); setPhase('error'); } }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {                                         // retry buffered writes: on a timer and when the browser is back online
    if (!attemptId) return undefined;
    const retry = () => flush(attemptId);
    const t = setInterval(() => { if (queue.current.length) retry(); }, RETRY_MS);
    window.addEventListener('online', retry);
    return () => { clearInterval(t); window.removeEventListener('online', retry); };
  }, [attemptId, flush]);

  const begin = async (startAt) => {
    setError(''); setLimitMessage('');
    try {
      setModel(await api.resume(attemptId));
      setIndex(startAt); setPhase('item');
    } catch (err) {
      if (err.code === 'SESSION_LIMIT') setLimitMessage(err.message); else setError(err.message);
    }
  };

  const firstUnanswered = () => { const i = items.findIndex((it) => answers[it.itemId] == null); return i === -1 ? 0 : i; };

  const choose = (item, value) => {
    setAnswers((a) => ({ ...a, [item.itemId]: value }));
    queue.current.push({ itemId: item.itemId, value, idempotencyKey: newKey('resp'), presentedOrder: item.order });
    flush(attemptId);
  };

  const pause = async () => {
    await flush(attemptId);
    if (queue.current.length) { setError('Your latest answers have not been saved yet. Please check your connection and try again.'); return; }
    try { await api.pause(attemptId, 'PARTICIPANT'); navigate('/student'); } catch (err) { setError(err.message); }
  };

  const submit = async () => {
    await flush(attemptId);
    if (queue.current.length) { setError('Your latest answers have not been saved yet. Please check your connection and try again.'); return; }
    if (!submitKey.current) submitKey.current = newKey('submit');        // one key per submit intention, reused on retry
    try { await api.submit(attemptId, submitKey.current); navigate('/student/complete'); } catch (err) { setError(err.message); }
  };

  if (phase === 'loading') return <div aria-busy="true" className={styles.stack}><Skeleton /><Skeleton /></div>;
  if (phase === 'error') return <StatusMessage type="error" message={error} />;

  const answered = Object.keys(answers).length;
  const session = model ? Math.max(model.session.n, 1) : 1;

  if (phase === 'hub') {
    const blocks = Object.keys(DOMAIN_NAMES).map((code) => {
      const inDomain = items.filter((i) => i.domainCode === code);
      return { code, total: inDomain.length, done: inDomain.filter((i) => answers[i.itemId] != null).length };
    });
    return (
      <div className={styles.stack}>
        <h1 className={styles.h2}>Your assessment</h1>
        <ProgressSummary answered={answered} total={items.length} domainName="All areas" sessionCount={session} />
        {error && <StatusMessage type="error" message={error} />}
        {limitMessage && <StatusMessage type="warning" message={limitMessage} />}
        <div className={styles.blocks}>
          {blocks.map((b) => (
            <section key={b.code} className={`${styles.card} ${styles.toneBlue}`}>
              <h2 className={styles.h3}>{b.code} · {DOMAIN_NAMES[b.code]}</h2>
              <div className={styles.bar} role="progressbar" aria-label={`${DOMAIN_NAMES[b.code]} progress`} aria-valuemin={0} aria-valuemax={b.total} aria-valuenow={b.done}>
                <div className={styles.barFill} style={{ width: `${b.total ? (b.done / b.total) * 100 : 0}%` }} />
              </div>
              <p className={styles.muted}>{b.done} of {b.total}</p>
            </section>
          ))}
        </div>
        <p className={styles.muted}>{model && model.lastSavedAt ? `Last saved ${new Date(model.lastSavedAt).toLocaleString()}` : 'Nothing saved yet'}</p>
        <div className={styles.row}>
          <Button onClick={() => begin(firstUnanswered())} disabled={Boolean(limitMessage)}>Continue Assessment</Button>
          {answered === items.length && items.length > 0 && <Button variant="secondary" onClick={submit}>Submit my answers</Button>}
          {limitMessage && <Button variant="secondary" onClick={submit}>Submit my answers</Button>}
        </div>
      </div>
    );
  }

  const item = items[index];
  const domain = DOMAIN_NAMES[item.domainCode];
  return (
    <div className={`${styles.stack} ${styles.player}`}>
      <ProgressSummary answered={answered} total={items.length} domainName={domain} sessionCount={session} />
      {error && <StatusMessage type="error" message={error} />}
      <p className={styles.muted}>Question {index + 1} of {items.length}</p>
      <h1 className={styles.itemText}>{item.text}</h1>
      <ResponseScale anchors={anchors} value={answers[item.itemId] ?? null} onChange={(v) => choose(item, v)} name={`item-${item.itemId}`} label="How often is this true for you?" />
      <p className={styles.saveState} role="status">
        {saveState === 'saved' ? 'All answers saved' : saveState === 'saving' ? 'Saving…' : 'Not saved yet - we will keep trying'}
      </p>
      <div className={styles.rowBetween}>
        <Button variant="secondary" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}>Back</Button>
        <Button variant="quiet-link" onClick={pause}>Pause</Button>
        {index < items.length - 1
          ? <Button onClick={() => setIndex((i) => i + 1)} disabled={answers[item.itemId] == null}>Next</Button>
          : <Button onClick={submit} disabled={answered < items.length}>Submit my answers</Button>}
      </div>
    </div>
  );
}

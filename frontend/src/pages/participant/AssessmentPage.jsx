/*
 * The assessment player (screens 11-15 are REFERENCE only; the sample's four-section questionnaire and profile/consent steps
 * are NOT built - registration owns those). A hub of seven domain blocks, then one question at a time with ITS OWN answer options (2 to 20, feature 006).
 *  - Answers are saved through a buffered queue: every logical write keeps ITS OWN idempotency key and is retried with that
 *    same key until the server acknowledges, so a lost reply never creates a second version.
 *  - Pause, session n of 4, last saved and one Continue action come from the server's resume model. No scores anywhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowRight, BookOpen, Compass, Heart, Leaf, Lock, Pause, UserRound, Users } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { Breadcrumb, IconBadge, InfoNote } from '../../components/participantKit';
import Button from '../../components/Button/Button';
import ProgressSummary from '../../components/ProgressSummary/ProgressSummary';
import QuestionOptions from '../../components/QuestionOptions/QuestionOptions';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api, newKey } from '../../services/santulanApi';

export const DOMAIN_NAMES = {
  C1: 'Body & Self-Regulation', C2: 'Emotional Capability', C3: 'Relational & Social Capability', C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency', C6: 'Adaptability & Resilience', C7: 'Self-Directed Learning & Executive Capability',
};
const RETRY_MS = 5000;
/** One icon and tint per domain (samples 11 and the mobile question screen). */
const DOMAIN_LOOK = {
  C1: { icon: Activity, badge: 'green', tone: p.toneB }, C2: { icon: Heart, badge: 'pink', tone: p.toneC }, C3: { icon: Users, badge: 'lavender', tone: p.toneD },
  C4: { icon: UserRound, badge: 'blue', tone: p.toneA }, C5: { icon: Compass, badge: 'cream', tone: p.toneE }, C6: { icon: Leaf, badge: 'green', tone: p.toneB },
  C7: { icon: BookOpen, badge: 'blue', tone: p.toneA },
};

export default function AssessmentPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('loading');            // loading | hub | item | error
  const [error, setError] = useState('');
  const [attemptId, setAttemptId] = useState(null);
  const [model, setModel] = useState(null);
  const [items, setItems] = useState([]);
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
        setAttemptId(id); setModel(m); setItems(list.items);
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
      const firstOpen = items.findIndex((i) => i.domainCode === code && answers[i.itemId] == null);
      return { code, total: inDomain.length, done: inDomain.filter((i) => answers[i.itemId] != null).length, startAt: firstOpen === -1 ? items.findIndex((i) => i.domainCode === code) : firstOpen };
    });
    return (
      <div className={p.page}>
        <Breadcrumb items={[{ label: 'Home', to: '/student' }, { label: 'Assessment' }]} />
        <div className={p.hubHead}>
          <div className={styles.stack}>
            <div>
              <h1 className={p.pageTitle}>Your assessment</h1>
              <p className={p.pageLead}>Take your time. There are no right or wrong answers, and you can pause and come back later.</p>
            </div>
            <ProgressSummary answered={answered} total={items.length} domainName="All areas" sessionCount={session} />
          </div>
          <ImageSlot slot="assessmentHero" className={p.hubArt} />
        </div>
        <InfoNote>Your responses are confidential and used only to support your participation. You can pause at any time.</InfoNote>
        {error && <StatusMessage type="error" message={error} />}
        {limitMessage && <StatusMessage type="warning" message={limitMessage} />}
        <div>
          <p className={p.sectionTitle}>Assessment sections</p>
          <p className={styles.muted} style={{ margin: 0 }}>Complete all seven areas to get the full picture.</p>
        </div>
        <div className={p.domainGrid}>
          {blocks.map((b) => {
            const look = DOMAIN_LOOK[b.code];
            const label = b.done === 0 ? 'Start' : b.done >= b.total && b.total > 0 ? 'Review' : 'Continue';
            return (
              <section key={b.code} className={`${p.domainCard} ${look.tone}`}>
                <div className={p.domainHead}>
                  <IconBadge icon={look.icon} tone={look.badge} />
                  <h2 className={p.domainName}>{b.code} · {DOMAIN_NAMES[b.code]}</h2>
                </div>
                <div className={styles.bar} role="progressbar" aria-label={`${DOMAIN_NAMES[b.code]} progress`} aria-valuemin={0} aria-valuemax={b.total} aria-valuenow={b.done}>
                  <div className={styles.barFill} style={{ width: `${b.total ? (b.done / b.total) * 100 : 0}%` }} />
                </div>
                <div className={p.domainFoot}>
                  <p className={p.count}>{b.done} of {b.total}</p>
                  <Button aria-label={`${label} ${DOMAIN_NAMES[b.code]}`} onClick={() => begin(b.startAt)} disabled={Boolean(limitMessage) || b.total === 0}>{label} <ArrowRight size={18} aria-hidden="true" /></Button>
                </div>
              </section>
            );
          })}
        </div>
        <p className={styles.muted} style={{ margin: 0 }}>{model && model.lastSavedAt ? `Last saved ${new Date(model.lastSavedAt).toLocaleString()}` : 'Nothing saved yet'}</p>
        <div className={p.buttonRow}>
          <Button size="lg" onClick={() => begin(firstUnanswered())} disabled={Boolean(limitMessage)}>Continue Assessment <ArrowRight size={20} aria-hidden="true" /></Button>
          {answered === items.length && items.length > 0 && <Button variant="secondary" size="lg" onClick={submit}>Submit my answers</Button>}
          {limitMessage && <Button variant="secondary" size="lg" onClick={submit}>Submit my answers</Button>}
        </div>
        <InfoNote icon={Lock} tone="quiet">Your responses are secure and private.</InfoNote>
      </div>
    );
  }

  const item = items[index];
  const domain = DOMAIN_NAMES[item.domainCode];
  const look = DOMAIN_LOOK[item.domainCode];
  return (
    <div className={p.player}>
      <div className={p.playerCard}>
        <div className={p.domainChip}>
          <IconBadge icon={look.icon} tone={look.badge} size="sm" />
          <div>
            <p className={p.chipTitle}>{domain}</p>
            <p className={p.chipSub}>Question {index + 1} of {items.length}</p>
          </div>
        </div>
        <ProgressSummary answered={answered} total={items.length} domainName={domain} sessionCount={session} />
        {error && <StatusMessage type="error" message={error} />}
        <h1 className={p.question}>{item.text}</h1>
        <QuestionOptions options={item.options} value={answers[item.itemId] ?? null} onChange={(v) => choose(item, v)} name={`item-${item.itemId}`} label="Choose the answer that fits you best" />
        <p className={p.saveState} role="status">
          {saveState === 'saved' ? 'All answers saved' : saveState === 'saving' ? 'Saving…' : 'Not saved yet - we will keep trying'}
        </p>
        <div className={p.navRow}>
          <Button variant="secondary" size="lg" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}><ArrowLeft size={20} aria-hidden="true" /> Previous</Button>
          <Button variant="quiet-link" onClick={pause}><Pause size={18} aria-hidden="true" /> Pause</Button>
          {index < items.length - 1
            ? <Button size="lg" onClick={() => setIndex((i) => i + 1)} disabled={answers[item.itemId] == null}>Next <ArrowRight size={20} aria-hidden="true" /></Button>
            : <Button size="lg" onClick={submit} disabled={answered < items.length}>Submit my answers</Button>}
        </div>
      </div>
    </div>
  );
}

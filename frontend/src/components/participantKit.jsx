/*
 * Small reusable pieces for the participant screens (design-system.md §2.2-§2.4): StepIndicator, OtpInput, CopyField,
 * StageStepper, RailCard/InfoNote/Feature/IconBadge/ChoiceCard, the RadarChart and the page furniture. They share one stylesheet.
 */
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Copy, Info, Lightbulb, ShieldCheck, Users } from 'lucide-react';
import styles from '../styles/ui.module.css';
import buttonStyles from './Button/Button.module.css';

const BADGE_TONE = { blue: styles.badgeBlue, green: styles.badgeGreen, pink: styles.badgePink, lavender: styles.badgeLavender, cream: styles.badgeCream };

/** A round icon in one of the sample tints. */
export function IconBadge({ icon: Icon, tone = 'blue', size = 'md' }) {
  const sizeClass = size === 'sm' ? styles.badgeSm : size === 'lg' ? styles.badgeLg : '';
  return <span className={`${styles.badge} ${sizeClass} ${BADGE_TONE[tone] || ''}`.trim()} aria-hidden="true">{Icon && <Icon size={size === 'sm' ? 22 : size === 'lg' ? 34 : 28} strokeWidth={1.75} />}</span>;
}

/** Icon + heading + one line of text (value strips, feature rows). */
export function Feature({ icon, tone = 'blue', title, children, as: Heading = 'p' }) {
  return (
    <div className={styles.feature}>
      <IconBadge icon={icon} tone={tone} />
      <div>
        <Heading className={styles.featureTitle}>{title}</Heading>
        {children && <p className={styles.featureText}>{children}</p>}
      </div>
    </div>
  );
}

/** A tinted one-line note with a leading icon ("This assessment...", "Your information is secure..."). */
export function InfoNote({ icon: Icon = Info, tone, children, className = '' }) {
  const toneClass = { green: styles.noteGreen, cream: styles.noteCream, quiet: styles.noteQuiet }[tone] || '';
  return (
    <p className={`${styles.note} ${toneClass} ${className}`.trim()}>
      <Icon size={22} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Connected dots with "Step n of 5" above; the step is announced to assistive technology through the list label. */
export function StepIndicator({ current, total = 5, labels = [] }) {
  return (
    <div className={styles.stepWrap}>
      <span className={styles.stepLabel} aria-hidden="true">Step {current} of {total}</span>
      <ol className={styles.steps} aria-label={`Step ${current} of ${total}`}>
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const state = n < current ? styles.stepDone : n === current ? styles.stepCurrent : '';
          return (
            <li key={n} aria-current={n === current ? 'step' : undefined} className={n < current ? styles.stepLineDone : ''}>
              <span className={`${styles.stepDot} ${state}`} aria-hidden="true">{n < current ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span className="sr-only">{labels[i] || `Step ${n}`}{n < current ? ' (done)' : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Six labelled boxes: auto-advance, backspace, paste-fill, one-time-code autofill. */
export function OtpInput({ value, onChange, length = 6, label = 'Verification code', disabled = false }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');
  const set = (next) => onChange(next.replace(/\D/g, '').slice(0, length));

  const handle = (i, raw) => {
    const chars = raw.replace(/\D/g, '');
    if (!chars) { set(digits.map((d, idx) => (idx === i ? '' : d)).join('')); return; }
    const next = digits.slice();
    chars.split('').forEach((c, k) => { if (i + k < length) next[i + k] = c; });
    set(next.join(''));
    refs.current[Math.min(i + chars.length, length - 1)]?.focus();
  };
  return (
    <div role="group" aria-label={label} className={styles.otp}
      onPaste={(e) => { e.preventDefault(); set(e.clipboardData.getData('text')); refs.current[length - 1]?.focus(); }}>
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className={styles.otpBox} inputMode="numeric" pattern="[0-9]*" maxLength={length}
          autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${i + 1} of ${length}`} value={d} disabled={disabled}
          onChange={(e) => handle(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }} />
      ))}
    </div>
  );
}

/** Shows a value with a Copy action that announces "Copied". `hint` is the line under the box. */
export function CopyField({ label, value, hint }) {
  const [copied, setCopied] = useState(false);
  const labelId = useId();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch (err) { setCopied(false); }
  };
  return (
    <div className={styles.copyBox}>
      <p className={styles.copyLabel} id={labelId}>{label}</p>
      <div className={styles.copyRow}>
        <code className={styles.mono} aria-labelledby={labelId}>{value}</code>
        <button type="button" className={styles.copyButton} onClick={copy}><Copy size={18} aria-hidden="true" />Copy</button>
      </div>
      <p className={styles.copyHint} role="status" aria-live="polite">{copied ? 'Copied' : hint || ''}</p>
    </div>
  );
}

/** Pipeline stages from REAL state only; the current stage is announced politely. */
export function StageStepper({ stages, currentIndex, label = 'Report progress' }) {
  return (
    <ol className={styles.stages} aria-label={label} aria-live="polite">
      {stages.map((s, i) => (
        <li key={s} className={`${styles.stage} ${i < currentIndex ? styles.stageDone : ''} ${i === currentIndex ? styles.stageCurrent : ''}`} aria-current={i === currentIndex ? 'step' : undefined}>
          <span className={styles.stageMark} aria-hidden="true">{i < currentIndex ? <Check size={16} strokeWidth={3} /> : null}</span>
          <span>{s}{i < currentIndex ? ' (done)' : i === currentIndex ? ' (in progress)' : ''}</span>
        </li>
      ))}
    </ol>
  );
}

const RAIL = {
  sky: { cls: styles.toneSky, badge: 'blue', icon: Lightbulb },
  safe: { cls: styles.toneGreen, badge: 'green', icon: ShieldCheck },
  help: { cls: styles.toneLavender, badge: 'lavender', icon: Users },
  note: { cls: styles.toneCream, badge: 'cream', icon: null },
};

/** Tinted card with an icon, a serif heading and text: notes, help and "why this matters". `icon={false}` shows no icon. */
export function RailCard({ tone = 'sky', title, icon, children, as: Heading = 'h2' }) {
  const t = RAIL[tone] || RAIL.sky;
  const Icon = icon === false ? null : icon || t.icon;
  return (
    <section className={`${styles.railCard} ${t.cls}`}>
      {Icon && <IconBadge icon={Icon} tone={t.badge} size="sm" />}
      <div className={styles.railBody}>
        {title && <Heading className={styles.h3}>{title}</Heading>}
        {children}
      </div>
    </section>
  );
}

/**
 * Seven-axis radar (1.00 - 5.00). A null score is drawn as "Not enough data" (no point), never as zero. There is no
 * benchmark ring, no band and no comparison: only the participant's own released values.
 */
export function RadarChart({ axes }) {
  const size = 320; const c = size / 2; const r = 110;
  const angle = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / axes.length;
  const point = (i, v) => [c + Math.cos(angle(i)) * r * ((v - 1) / 4), c + Math.sin(angle(i)) * r * ((v - 1) / 4)];
  const drawn = axes.map((a, i) => (a.score == null ? null : point(i, a.score)));
  const path = drawn.filter(Boolean).map((p) => p.join(',')).join(' ');
  return (
    <div>
      <svg className={styles.radar} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Your results across ${axes.length} areas`}>
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon key={ring} points={axes.map((_, i) => point(i, ring).join(',')).join(' ')} fill="none" stroke="var(--c-track)" strokeWidth="1" />
        ))}
        {axes.map((a, i) => (<line key={a.code} x1={c} y1={c} x2={point(i, 5)[0]} y2={point(i, 5)[1]} stroke="var(--c-track)" />))}
        {path && <polygon points={path} fill="var(--c-selected)" stroke="var(--c-brand)" strokeWidth="2" />}
        {drawn.map((p, i) => p && <circle key={axes[i].code} cx={p[0]} cy={p[1]} r="4" fill="var(--c-brand)" />)}
        {axes.map((a, i) => { const [x, y] = point(i, 5.6); return <text key={a.code} x={x} y={y} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--c-ink)">{a.code}</text>; })}
      </svg>
      <ul className={styles.axisList}>
        {axes.map((a) => (
          <li key={a.code} className={styles.axisItem}>
            <span>{a.code} {a.name}</span>
            <strong>{a.score == null ? (a.message || 'Not enough data yet') : a.score.toFixed(2)}</strong>
            {a.score != null && a.note && <span className={styles.muted}>{a.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two-column hero: copy on one side, a tinted panel on the other; stacks on narrow screens. */
export function SplitHero({ children, aside }) {
  return (
    <section className={styles.pageGrid}>
      <div>{children}</div>
      <div className={`${styles.card} ${styles.toneSky}`}>{aside}</div>
    </section>
  );
}

/** A whole-row radio/checkbox option with the selected tint (design-system §2.3). */
export function SelectableCard({ type = 'radio', name, value, checked, onChange, children }) {
  return (
    <label className={`${styles.option} ${checked ? styles.optionSelected : ''}`}>
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

/**
 * A large radio card with an icon, a serif title, a description and a tag (sample 07). The radio is named by the title and
 * described by the description, so the accessible name stays short.
 */
export function ChoiceCard({ name, value, checked, onChange, icon, tone = 'green', title, description, tag }) {
  const id = useId();
  return (
    <label className={`${styles.choice} ${tone === 'blue' ? styles.choiceBlue : ''} ${checked ? styles.choiceSelected : ''}`.trim()}>
      <input type="radio" className={styles.choiceInput} name={name} value={value} checked={checked} onChange={onChange} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} />
      {icon && <IconBadge icon={icon} tone={tone === 'blue' ? 'blue' : 'green'} />}
      <span className={styles.choiceBody}>
        <span id={`${id}-t`} className={styles.choiceTitle} style={{ display: 'block' }}>{title}</span>
        <span id={`${id}-d`} className={styles.choiceText} style={{ display: 'block' }}>{description}</span>
        {tag && <span className={`${styles.pill} ${tone === 'green' ? styles.pillGreen : ''}`.trim()}>{tag}</span>}
      </span>
    </label>
  );
}

/** "Home > Page" trail for the participant area; the current page is not a link. */
export function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.muted}>
      <ol className={styles.crumbs}>
        {items.map((it, i) => (
          <li key={it.label} aria-current={i === items.length - 1 ? 'page' : undefined}>
            {it.to && i < items.length - 1 ? <Link className={styles.pageLink} to={it.to}>{it.label}</Link> : it.label}
            {i < items.length - 1 && <ChevronRight className={styles.crumbSep} size={14} aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** An on/off switch with a visible label; exposes role="switch" and aria-checked. */
export function Toggle({ label, checked, onChange, hint }) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <div>
        <span id={`${id}-label`} className={styles.toggleLabel}>{label}</span>
        {hint && <p className={styles.muted} id={`${id}-hint`} style={{ margin: '2px 0 0' }}>{hint}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${styles.switch} ${checked ? styles.switchOn : ''}`} onClick={() => onChange(!checked)}>
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A link that looks like a Button variant (navigation stays an anchor, so it works with middle-click and screen readers). */
export function ButtonLink({ to, variant = 'primary', children, icon = false, size = 'md', block = true, className = '' }) {
  const cls = [buttonStyles.button, buttonStyles[variant], size === 'lg' ? buttonStyles.lg : '', block ? buttonStyles.block : '', styles.fullWidth, className].filter(Boolean).join(' ');
  return (
    <Link to={to} className={cls}>
      {children}
      {icon && <ArrowRight size={18} aria-hidden="true" />}
    </Link>
  );
}

/** A list of ticked benefits/steps (the route cards of screen 03). */
export function CheckList({ items, tone = 'green' }) {
  return (
    <ul className={`${styles.checkList} ${tone === 'blue' ? styles.checkListBlue : ''}`.trim()}>
      {items.map((t) => (<li key={t}><span className={styles.tick} aria-hidden="true"><Check size={14} strokeWidth={3} /></span><span>{t}</span></li>))}
    </ul>
  );
}

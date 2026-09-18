import { useRef } from 'react';
import styles from './ResponseScale.module.css';

const VALUES = [1, 2, 3, 4, 5];

/**
 * The frozen 1-5 Likert scale. FR-005: no option ever carries a right/wrong
 * visual (no success/error color or check/cross icon on a selected option) -
 * selection uses only the neutral brand-soft tint.
 */
export default function ResponseScale({ anchors, value, onChange, name, label = 'Response scale' }) {
  const refs = useRef({});

  const focusValue = (v) => {
    refs.current[v]?.focus();
  };

  const handleKeyDown = (event, currentValue) => {
    const index = VALUES.indexOf(currentValue);
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = Math.min(index + 1, VALUES.length - 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = Math.max(index - 1, 0);
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const nextValue = VALUES[nextIndex];
      onChange(nextValue);
      focusValue(nextValue);
    }
  };

  return (
    <div className={styles.scale} role="radiogroup" aria-label={label}>
      {VALUES.map((v) => {
        const selected = value === v;
        return (
          <button
            key={v}
            type="button"
            ref={(el) => {
              refs.current[v] = el;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value == null && v === VALUES[0]) ? 0 : -1}
            className={`${styles.chip} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(v)}
            onKeyDown={(e) => handleKeyDown(e, v)}
            name={name}
          >
            <span className={styles.value}>{v}</span>
            <span className={styles.label}>{anchors[String(v)]}</span>
          </button>
        );
      })}
    </div>
  );
}

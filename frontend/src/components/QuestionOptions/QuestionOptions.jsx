import { useRef } from 'react';
import styles from './QuestionOptions.module.css';

/**
 * The answer choices of ONE question, for any number of options from 2 to 20, in the order the question set gives them
 * (feature 006). The value is the option's POSITION. No option ever carries a right/wrong or good/bad cue (FR-005): selection
 * uses only the neutral brand tint plus a heavier border, so it reads from shape as well as colour.
 *
 * options: [{ position, text }]   value: the chosen position or null   onChange(position)
 */
export default function QuestionOptions({ options, value, onChange, name, label = 'Choose one answer' }) {
  const refs = useRef({});
  const positions = options.map((o) => o.position);

  const focusPosition = (p) => refs.current[p]?.focus();

  const handleKeyDown = (event, current) => {
    const index = positions.indexOf(current);
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(index + 1, positions.length - 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = positions.length - 1;
    if (next !== null) {
      event.preventDefault();
      onChange(positions[next]);
      focusPosition(positions[next]);
    }
  };

  return (
    <div className={`${styles.group} ${options.length > 5 ? styles.many : ''}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = value === o.position;
        return (
          <button
            key={o.position}
            type="button"
            ref={(el) => { refs.current[o.position] = el; }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value == null && o.position === positions[0]) ? 0 : -1}
            className={`${styles.option} ${selected ? styles.selected : ''}`.trim()}
            onClick={() => onChange(o.position)}
            onKeyDown={(e) => handleKeyDown(e, o.position)}
            name={name}
          >
            <span className={styles.position}>{o.position}</span>{' '}
            <span className={styles.text}>{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

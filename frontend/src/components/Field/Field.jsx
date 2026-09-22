import { useId } from 'react';
import styles from './Field.module.css';

export default function Field({ label, name, error, hint, as = 'input', icon: Icon, trailing, size, children, className = '', ...rest }) {
  const inputId = useId();
  const describedById = error || hint ? `${inputId}-desc` : undefined;
  const Tag = as;
  const controlClass = [styles.control, size === 'lg' ? styles.lg : '', Icon ? styles.withIcon : '', trailing ? styles.withTrailing : ''].filter(Boolean).join(' ');

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={styles.controlWrap}>
        {Icon && <Icon className={styles.icon} size={20} aria-hidden="true" />}
        {as === 'select' ? (
          <Tag
            id={inputId}
            name={name}
            className={controlClass}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedById}
            {...rest}
          >
            {children}
          </Tag>
        ) : (
          <Tag
            id={inputId}
            name={name}
            className={controlClass}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedById}
            {...rest}
          />
        )}
        {trailing && <span className={styles.trailing}>{trailing}</span>}
      </div>
      {error && (
        <p id={describedById} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={describedById} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

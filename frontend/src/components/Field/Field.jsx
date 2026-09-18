import { useId } from 'react';
import styles from './Field.module.css';

export default function Field({ label, name, error, hint, as = 'input', children, className = '', ...rest }) {
  const inputId = useId();
  const describedById = error || hint ? `${inputId}-desc` : undefined;
  const Tag = as;

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      {as === 'select' ? (
        <Tag
          id={inputId}
          name={name}
          className={styles.control}
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
          className={styles.control}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedById}
          {...rest}
        />
      )}
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

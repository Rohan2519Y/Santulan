import { useId } from 'react';
import styles from './Panel.module.css';

/** A titled dashboard section. `title` becomes the panel's accessible name. */
export default function Panel({ title, subtitle, actions, children, className = '', flush = false }) {
  const headingId = useId();
  return (
    <section className={`${styles.panel} ${className}`.trim()} aria-labelledby={title ? headingId : undefined}>
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title && (
              <h2 id={headingId} className={styles.title}>
                {title}
              </h2>
            )}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
    </section>
  );
}

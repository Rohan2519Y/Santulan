import styles from './StatTile.module.css';

/**
 * A headline number (dataviz: a single value is a stat tile, not a one-bar chart).
 * The value uses proportional figures; `hint` says what the number means or how it compares.
 */
export default function StatTile({ label, value, hint, icon: Icon, tone = 'brand' }) {
  return (
    <div className={`${styles.tile} ${styles[tone] || ''}`.trim()}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {Icon && (
          <span className={styles.iconWrap} aria-hidden="true">
            <Icon size={18} />
          </span>
        )}
      </div>
      <p className={styles.value}>{value}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

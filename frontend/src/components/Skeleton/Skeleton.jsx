import styles from './Skeleton.module.css';

/**
 * FR-007/research §6: reserves the exact final-layout size (zero shift when
 * data lands), hidden from assistive tech - the parent region should carry
 * `aria-busy="true"` and a debounced `role="status"` sr-only announcement.
 */
export default function Skeleton({ width = '100%', height = 16, radius = 'var(--radius-sm)', className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.skeleton} ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

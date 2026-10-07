import { CircleCheck, Info, TriangleAlert, CircleAlert, Clock } from 'lucide-react';
import styles from './StatusMessage.module.css';

const ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
  neutral: Clock,
};

const ALERT_TYPES = new Set(['error', 'warning']);

/**
 * FR-004: every status is color + icon + text label - never color alone.
 * `message` is required so a StatusMessage can never render icon-only.
 */
export default function StatusMessage({ type = 'info', message, children, className = '', live = true }) {
  const Icon = ICONS[type] || Info;
  // `live={false}` renders a plain, non-announcing block: used where the text is a secret (a temporary password) that a screen
  // reader must not read out unprompted (audit gap G-43).
  const role = !live ? undefined : (ALERT_TYPES.has(type) ? 'alert' : 'status');

  return (
    <div className={`${styles.message} ${styles[type]} ${className}`.trim()} role={role}>
      <Icon className={styles.icon} aria-hidden="true" size={20} />
      <span className={styles.text}>
        {message}
        {children}
      </span>
    </div>
  );
}

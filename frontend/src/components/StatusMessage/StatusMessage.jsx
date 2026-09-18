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
export default function StatusMessage({ type = 'info', message, children, className = '' }) {
  const Icon = ICONS[type] || Info;
  const role = ALERT_TYPES.has(type) ? 'alert' : 'status';

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

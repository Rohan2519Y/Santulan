import { CircleCheck, Info, TriangleAlert, CircleAlert, Clock } from 'lucide-react';
import { statusMeta } from '../../pages/admin/adminMetrics';
import styles from './StatusPill.module.css';

const ICONS = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert, neutral: Clock };

/** An attempt status: tone color + icon + text label - never color alone (FR-004 of spec 003). */
export default function StatusPill({ status, label, tone }) {
  const meta = statusMeta(status);
  const t = tone || meta.tone;
  const Icon = ICONS[t] || Clock;
  return (
    <span className={`${styles.pill} ${styles[t]}`}>
      <Icon className={styles.icon} aria-hidden="true" size={14} />
      {label || meta.label}
    </span>
  );
}

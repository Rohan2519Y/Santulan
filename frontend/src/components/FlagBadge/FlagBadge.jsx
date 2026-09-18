import { ShieldAlert, ShieldCheck } from 'lucide-react';
import styles from './FlagBadge.module.css';

/**
 * Quality flag chip (Q01-Q09). Needs-review vs. dispositioned are
 * distinguished by icon AND label, never color alone (FR-004).
 */
export default function FlagBadge({ flagCode, disposition }) {
  const reviewed = !!disposition;
  const Icon = reviewed ? ShieldCheck : ShieldAlert;

  return (
    <span className={`${styles.badge} ${reviewed ? styles.reviewed : styles.needsReview}`}>
      <Icon className={styles.icon} aria-hidden="true" size={16} />
      <span className={styles.code}>{flagCode}</span>
      <span className={styles.label}>{reviewed ? 'Reviewed' : 'Needs review'}</span>
    </span>
  );
}

import { ListChecks } from 'lucide-react';
import styles from './ProgressSummary.module.css';

/**
 * FR-002: graphical progress (bar width = ratio + icon), never text-only.
 */
export default function ProgressSummary({ answered, total, domainName, sessionCount, maxSessions = 4 }) {
  const ratio = total > 0 ? Math.min(answered / total, 1) : 0;

  return (
    <div className={styles.summary}>
      <div className={styles.headline}>
        <ListChecks className={styles.icon} aria-hidden="true" size={20} />
        <span>
          {answered} of {total} answered
        </span>
        {domainName && <span className={styles.domain}>{domainName}</span>}
        <span className={styles.session}>
          session {sessionCount} of {maxSessions}
        </span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-label="Assessment progress"
      >
        <div className={styles.fill} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="sr-only" role="status">
        {answered} of {total} questions answered, currently in {domainName}, session {sessionCount} of {maxSessions}.
      </span>
    </div>
  );
}

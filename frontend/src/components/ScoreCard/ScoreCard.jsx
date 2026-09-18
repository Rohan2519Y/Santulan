import Card from '../Card/Card';
import StatusMessage from '../StatusMessage/StatusMessage';
import styles from './ScoreCard.module.css';

const HELD_LABEL = 'Under review';
const INSUFFICIENT_LABEL = 'Not enough data';

/**
 * One domain result. Normal vs. neutral (held/insufficient) are distinguished
 * by icon+label+color (never color alone) - a held construct never reads as
 * an error (US1 scenario 3).
 */
export default function ScoreCard({ domainName, rawScore, completenessRate, scoreStatus, body }) {
  const isHeld = scoreStatus === 'SH';
  const isOperational = rawScore != null && !isHeld;

  return (
    <Card className={styles.card}>
      <h3 className={styles.title}>{domainName}</h3>
      {isOperational ? (
        <>
          <p className={styles.score}>
            {rawScore.toFixed(1)} <span className={styles.scoreMax}>/ 5.0</span>
          </p>
          <StatusMessage type="success" message={`Completed · ${Math.round(completenessRate * 100)}% answered`} />
        </>
      ) : (
        <StatusMessage type="neutral" message={isHeld ? HELD_LABEL : INSUFFICIENT_LABEL} />
      )}
      {body && <p className={styles.body}>{body}</p>}
    </Card>
  );
}

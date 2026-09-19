import { useCallback, useEffect, useState } from 'react';
import { getSubmissionDetail, reviewQualityFlag } from '../../services/assessmentApi';
import Modal from '../../components/Modal/Modal';
import Button from '../../components/Button/Button';
import Field from '../../components/Field/Field';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import ScoreCard from '../../components/ScoreCard/ScoreCard';
import FlagBadge from '../../components/FlagBadge/FlagBadge';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import { useToast } from '../../components/Toast/Toast';
import { DOMAIN_NAMES, formatDateTime } from './adminMetrics';
import styles from './adminPages.module.css';

/** Side drawer with one submission's scores and quality flags; flags are reviewed in a dialog. */
export default function SubmissionDrawer({ submission, onClose, onChanged }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(null); // the flag being reviewed
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getSubmissionDetail(submission.attemptId));
    } catch (err) {
      setError(err.message);
    }
  }, [submission.attemptId]);

  useEffect(() => {
    load();
  }, [load]);

  const closeReview = () => {
    setReviewing(null);
    setNote('');
  };

  const saveReview = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      await reviewQualityFlag(reviewing.id, note.trim());
      toast.push({ type: 'success', message: `Flag ${reviewing.flagCode} marked as reviewed.` });
      closeReview();
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      toast.push({ type: 'error', message: `Could not save the review: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open side onClose={onClose} title={`Submission ${submission.santulanId}`} description={submission.versionLabel}>
        <dl className={styles.detailGrid}>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusPill status={detail?.attempt.status || submission.status} />
            </dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>{detail?.attempt.sessionCount ?? submission.sessionCount} of 4</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDateTime(submission.submittedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatDateTime(submission.completedAt)}</dd>
          </div>
          {detail && (
            <div>
              <dt>Answered items</dt>
              <dd>{detail.responses.length}</dd>
            </div>
          )}
        </dl>

        {error && <StatusMessage type="error" message={error} />}

        {!detail && !error && (
          <div aria-busy="true">
            <span className="sr-only" role="status">
              Loading submission…
            </span>
            <Skeleton height={24} width="40%" className={styles.skeletonGap} />
            <Skeleton height={120} radius="var(--radius-md)" />
          </div>
        )}

        {detail && (
          <>
            <h3 className={styles.groupTitle}>Domain scores</h3>
            {detail.scores.length === 0 ? (
              <EmptyState message="No scores yet — the attempt has not been scored." />
            ) : (
              <div className={styles.scoreGrid}>
                {detail.scores.map((s) => (
                  <ScoreCard
                    key={s.domainCode}
                    domainName={`${s.domainCode} · ${DOMAIN_NAMES[s.domainCode] || s.domainCode}`}
                    rawScore={s.rawScore}
                    completenessRate={s.completenessRate}
                    scoreStatus={s.scoreStatus}
                  />
                ))}
              </div>
            )}

            <h3 className={styles.groupTitle}>Quality flags</h3>
            {detail.qualityFlags.length === 0 ? (
              <EmptyState message="No quality flags" />
            ) : (
              <ul className={styles.flagList}>
                {detail.qualityFlags.map((f) => (
                  <li key={f.id} className={styles.flagRow}>
                    <FlagBadge flagCode={f.flagCode} disposition={f.disposition} />
                    <span className={styles.muted}>{f.severity}</span>
                    {f.disposition && <span className={styles.flagNote}>{f.disposition}</span>}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setReviewing(f);
                        setNote(f.disposition || '');
                      }}
                    >
                      {f.disposition ? 'Edit review' : 'Review'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={!!reviewing}
        onClose={closeReview}
        title={reviewing ? `Review flag ${reviewing.flagCode}` : 'Review flag'}
        description="Record what was decided. The note is stored with the flag."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeReview}>
              Cancel
            </Button>
            <Button type="submit" form="review-flag-form" disabled={saving || !note.trim()}>
              {saving ? 'Saving…' : 'Save review'}
            </Button>
          </>
        }
      >
        <form id="review-flag-form" onSubmit={saveReview}>
          <Field label="Disposition note" name="disposition" as="textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus required />
        </form>
      </Modal>
    </>
  );
}

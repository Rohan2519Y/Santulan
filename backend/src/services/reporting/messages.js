/*
 * Fixed participant-facing report copy (BUILD 07 §5-§6, Development Reporting Master T11 / T12). One string per state: the copy
 * never varies by hold reason, never names a quality flag, severity or safeguarding rationale, and T12 states no reason at all
 * (a "safe administrative reason" may be disclosed only where policy permits, and no such policy is configured).
 */
const T11_UNDER_REVIEW = 'Your responses are being reviewed.';
const T12_NOT_ELIGIBLE = 'This attempt could not be processed for a report.';

module.exports = { T11_UNDER_REVIEW, T12_NOT_ELIGIBLE };

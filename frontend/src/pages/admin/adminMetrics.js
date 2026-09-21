/*
 * Vocabulary for the admin pages: attempt statuses (label, tone, group), the seven domain names and date formatting. No React and no
 * network. The dashboard numbers come from the server (GET /admin/monitoring/summary); nothing is counted or exported in the browser.
 */

/** Lifecycle order (also the order of the status chart). `tone` picks the status color + icon. */
export const STATUS_META = [
  { key: 'CREATED', label: 'Created', tone: 'neutral', group: 'active' },
  { key: 'STARTED', label: 'Started', tone: 'info', group: 'active' },
  { key: 'IN_PROGRESS', label: 'In progress', tone: 'info', group: 'active' },
  { key: 'PAUSED', label: 'Paused', tone: 'warning', group: 'active' },
  { key: 'SUBMITTED', label: 'Submitted', tone: 'info', group: 'processing' },
  { key: 'SCORING', label: 'Scoring', tone: 'info', group: 'processing' },
  { key: 'SCORED', label: 'Scored', tone: 'success', group: 'done' },
  { key: 'REPORT_READY', label: 'Report ready', tone: 'success', group: 'done' },
  { key: 'QUALITY_HOLD', label: 'Quality hold', tone: 'warning', group: 'attention' },
  { key: 'INVALID', label: 'Invalid', tone: 'error', group: 'attention' },
  { key: 'EXPIRED', label: 'Expired', tone: 'neutral', group: 'closed' },
];

const META_BY_KEY = new Map(STATUS_META.map((m) => [m.key, m]));

export const statusMeta = (key) => META_BY_KEY.get(key) || { key, label: key, tone: 'neutral', group: 'closed' };

/** The seven capability domains (contracts/item-pool-schema.md). */
export const DOMAIN_NAMES = {
  C1: 'Body & Self-Regulation',
  C2: 'Emotional Capability',
  C3: 'Relational & Social Capability',
  C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency',
  C6: 'Adaptability & Resilience',
  C7: 'Self-Directed Learning & Executive Capability',
};

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

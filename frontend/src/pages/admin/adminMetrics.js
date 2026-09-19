/*
 * Pure helpers for the admin dashboard (spec 005): status vocabulary, headline numbers,
 * filtering, sorting, paging and CSV export. No React, no network - easy to test.
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

/** A submission needs a human when it carries quality flags or is held / invalid. */
export const needsAttention = (s) => s.qualityFlagCount > 0 || s.status === 'QUALITY_HOLD' || s.status === 'INVALID';

/** Headline numbers and chart series from the submissions list. */
export function computeMetrics(submissions) {
  const list = submissions || [];
  const counts = new Map();
  const versions = new Map();
  let flagsTotal = 0;

  for (const s of list) {
    counts.set(s.status, (counts.get(s.status) || 0) + 1);
    versions.set(s.versionLabel, (versions.get(s.versionLabel) || 0) + 1);
    flagsTotal += s.qualityFlagCount || 0;
  }

  const inGroup = (group) => list.filter((s) => statusMeta(s.status).group === group).length;

  return {
    total: list.length,
    inProgress: inGroup('active'),
    completed: inGroup('done'),
    needsAttention: list.filter(needsAttention).length,
    flagsTotal,
    byStatus: STATUS_META.filter((m) => counts.get(m.key)).map((m) => ({ key: m.key, label: m.label, tone: m.tone, count: counts.get(m.key) })),
    // Statuses the API returns that this vocabulary does not know still get counted.
    byVersion: [...versions.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    recent: list.slice(0, 5),
  };
}

export function filterSubmissions(list, { query = '', status = 'ALL', version = 'ALL', attentionOnly = false } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter((s) => {
    if (q && !String(s.santulanId).toLowerCase().includes(q)) return false;
    if (status !== 'ALL' && s.status !== status) return false;
    if (version !== 'ALL' && s.versionLabel !== version) return false;
    if (attentionOnly && !needsAttention(s)) return false;
    return true;
  });
}

const SORTERS = {
  santulanId: (s) => String(s.santulanId),
  status: (s) => STATUS_META.findIndex((m) => m.key === s.status),
  sessionCount: (s) => s.sessionCount ?? 0,
  qualityFlagCount: (s) => s.qualityFlagCount ?? 0,
  submittedAt: (s) => (s.submittedAt ? new Date(s.submittedAt).getTime() : 0),
};

export function sortSubmissions(list, key = 'submittedAt', dir = 'desc') {
  const pick = SORTERS[key] || SORTERS.submittedAt;
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = pick(a);
    const y = pick(b);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return 0;
  });
}

export function paginate(list, page, pageSize) {
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize;
  return { rows: list.slice(start, start + pageSize), page: current, pages, from: list.length ? start + 1 : 0, to: Math.min(start + pageSize, list.length), total: list.length };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Quote when needed; also neutralise spreadsheet formulas (=, +, -, @) in text cells.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function submissionsToCsv(list) {
  const header = ['Santulan ID', 'Version', 'Status', 'Sessions', 'Quality flags', 'Submitted at', 'Completed at'];
  const lines = list.map((s) =>
    [s.santulanId, s.versionLabel, statusMeta(s.status).label, s.sessionCount, s.qualityFlagCount, s.submittedAt || '', s.completedAt || ''].map(csvCell).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

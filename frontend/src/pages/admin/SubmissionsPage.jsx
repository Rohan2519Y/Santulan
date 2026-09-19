import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Download, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import SubmissionDrawer from './SubmissionDrawer';
import { STATUS_META, filterSubmissions, sortSubmissions, paginate, submissionsToCsv, formatDateTime } from './adminMetrics';
import tableStyles from './adminTable.module.css';
import styles from './adminPages.module.css';

const PAGE_SIZE = 10;

const COLUMNS = [
  { key: 'santulanId', label: 'Santulan ID' },
  { key: 'versionLabel', label: 'Version', sortable: false },
  { key: 'status', label: 'Status' },
  { key: 'sessionCount', label: 'Sessions', num: true },
  { key: 'qualityFlagCount', label: 'Flags', num: true },
  { key: 'submittedAt', label: 'Submitted' },
];

function downloadCsv(rows) {
  const blob = new Blob([submissionsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `santulan-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SubmissionsPage({ submissions, status, error, onRefresh }) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'submittedAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  // Filters that other pages deep-link into live in the URL (?status=…&attention=1).
  const statusFilter = params.get('status') || 'ALL';
  const attentionOnly = params.get('attention') === '1';
  const versionFilter = params.get('version') || 'ALL';

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'ALL') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, attentionOnly, versionFilter]);

  const versions = useMemo(() => [...new Set(submissions.map((s) => s.versionLabel))].sort(), [submissions]);
  const filtered = useMemo(
    () => sortSubmissions(filterSubmissions(submissions, { query, status: statusFilter, version: versionFilter, attentionOnly }), sort.key, sort.dir),
    [submissions, query, statusFilter, versionFilter, attentionOnly, sort],
  );
  const view = paginate(filtered, page, PAGE_SIZE);
  const hasFilters = query || statusFilter !== 'ALL' || versionFilter !== 'ALL' || attentionOnly;

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'santulanId' ? 'asc' : 'desc' }));
  const clearFilters = () => {
    setQuery('');
    setParams(new URLSearchParams(), { replace: true });
  };

  if (status === 'error') {
    return (
      <>
        <PageHeader title="Submissions" />
        <StatusMessage type="error" message={`Could not load submissions: ${error}`} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Every attempt, its scores and quality flags."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onRefresh} disabled={status === 'loading'}>
              Refresh
            </Button>
            <Button type="button" variant="secondary" onClick={() => downloadCsv(filtered)} disabled={filtered.length === 0}>
              <Download size={16} aria-hidden="true" />
              Export CSV
            </Button>
          </>
        }
      />

      <Panel flush>
        <div className={styles.toolbar} role="search" aria-label="Filter submissions">
          <div className={styles.searchWrap}>
            <span className={styles.filterLabel} id="sub-search-label">
              Search
            </span>
            <div className={styles.searchField}>
              <Search className={styles.searchIcon} size={16} aria-hidden="true" />
              <input
                type="search"
                className={styles.searchInput}
                aria-labelledby="sub-search-label"
                placeholder="Santulan ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="sub-status">
              Status
            </label>
            <select id="sub-status" className={styles.control} value={statusFilter} onChange={(e) => setParam('status', e.target.value)}>
              <option value="ALL">All statuses</option>
              {STATUS_META.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="sub-version">
              Item-pool version
            </label>
            <select id="sub-version" className={styles.control} value={versionFilter} onChange={(e) => setParam('version', e.target.value)}>
              <option value="ALL">All versions</option>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setParam('attention', e.target.checked ? '1' : '')} />
            Needs attention only
          </label>
          {hasFilters && (
            <Button type="button" variant="quiet-link" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {status === 'loading' && submissions.length === 0 ? (
          <div aria-busy="true" className={styles.emptyPad}>
            <span className="sr-only" role="status">
              Loading submissions…
            </span>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={44} className={styles.skeletonGap} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            className={styles.emptyPad}
            message={submissions.length === 0 ? 'No submissions yet' : 'No submissions match these filters'}
            action={
              hasFilters ? (
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <caption className="sr-only">Submissions, sortable by column</caption>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => {
                      const sortable = c.sortable !== false;
                      const active = sort.key === c.key;
                      const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
                      return (
                        <th key={c.key} scope="col" className={c.num ? tableStyles.num : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}>
                          {sortable ? (
                            <button type="button" className={tableStyles.sortButton} onClick={() => toggleSort(c.key)}>
                              {c.label}
                              <Icon size={14} aria-hidden="true" />
                            </button>
                          ) : (
                            c.label
                          )}
                        </th>
                      );
                    })}
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((s) => (
                    <tr key={s.attemptId}>
                      <td className={tableStyles.mono}>{s.santulanId}</td>
                      <td>{s.versionLabel}</td>
                      <td>
                        <StatusPill status={s.status} />
                      </td>
                      <td className={tableStyles.num}>{s.sessionCount}</td>
                      <td className={tableStyles.num}>{s.qualityFlagCount > 0 ? <span className={tableStyles.flagChip}>{s.qualityFlagCount}</span> : <span className={tableStyles.flagZero}>0</span>}</td>
                      <td>{formatDateTime(s.submittedAt)}</td>
                      <td>
                        <button type="button" className={tableStyles.rowAction} onClick={() => setSelected(s)} aria-label={`View submission ${s.santulanId}`}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.pager}>
              <span aria-live="polite">
                Showing {view.from}–{view.to} of {view.total}
              </span>
              <div className={styles.pagerButtons}>
                <button type="button" className={styles.pageButton} onClick={() => setPage(view.page - 1)} disabled={view.page <= 1} aria-label="Previous page">
                  <ChevronLeft size={16} aria-hidden="true" />
                  Prev
                </button>
                <span>
                  Page {view.page} of {view.pages}
                </span>
                <button type="button" className={styles.pageButton} onClick={() => setPage(view.page + 1)} disabled={view.page >= view.pages} aria-label="Next page">
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>

      {selected && <SubmissionDrawer submission={selected} onClose={() => setSelected(null)} onChanged={onRefresh} />}
    </>
  );
}

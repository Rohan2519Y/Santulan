import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads server data for an admin page: { status: 'loading' | 'ready' | 'error', data, error, reload }.
 * The page always shows what the server holds; `reload` re-reads it after a change. A late response from an older request is ignored.
 */
export default function useAdminData(fetcher, deps = []) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const latest = useRef(0);
  const run = useCallback(async () => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const data = await fetcher();
      if (mine === latest.current) setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (mine === latest.current) setState({ status: 'error', data: null, error: err.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** { KEY: n } -> [{ key, label, count }] in the given order (unknown keys last), for a chart or list. */
export const countsToList = (counts, order = []) => {
  const entries = Object.entries(counts || {});
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([key, count]) => ({ key, label: key.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), count }));
};

import { useId, useState } from 'react';
import { Table2, ChartBarBig } from 'lucide-react';
import StatusPill from '../StatusPill/StatusPill';
import styles from './BarChart.module.css';

/**
 * Horizontal bars for one measure across named categories.
 *  - one series, so no legend box; each row is labelled directly and the value sits at the bar tip
 *  - bars are <=20px thick, 4px-rounded at the data end, square at the baseline
 *  - a `tone` (status) colours the bar AND shows an icon + label (never color alone);
 *    without a tone every bar is the single brand colour
 *  - hover/focus tooltip; with `onSelect` a bar is a real button (click to drill in)
 *  - "View as table" is the non-visual alternative; tooltips never gate a value
 * `data` = [{ key, label, count, tone? }]
 */
export default function BarChart({ data, ariaLabel, unit = 'submissions', onSelect }) {
  const [view, setView] = useState('chart');
  const [active, setActive] = useState(null);
  const tipId = useId();

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  if (!data.length) return null;

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toggle} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? <Table2 size={16} aria-hidden="true" /> : <ChartBarBig size={16} aria-hidden="true" />}
          {view === 'chart' ? 'View as table' : 'View as chart'}
        </button>
      </div>

      {view === 'table' ? (
        <table className={styles.table}>
          <caption className="sr-only">{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Count</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                <td>{d.count}</td>
                <td>{pct(d.count)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className={styles.list} aria-label={ariaLabel}>
          {data.map((d, i) => {
            const summary = `${d.label}: ${d.count} ${unit}, ${pct(d.count)}%`;
            const color = d.tone ? `var(--c-status-${d.tone})` : 'var(--c-brand)';
            const bar = (
              <>
                <span className={styles.bar} style={{ width: `${(d.count / max) * 86}%`, background: color }} />
                <span className={styles.value}>{d.count}</span>
              </>
            );
            const hover = {
              onMouseEnter: () => setActive(i),
              onMouseLeave: () => setActive(null),
              onFocus: () => setActive(i),
              onBlur: () => setActive(null),
            };
            return (
              <li key={d.key} className={styles.row}>
                <div className={styles.label}>{d.tone ? <StatusPill status={d.key} label={d.label} tone={d.tone} /> : d.label}</div>
                <div className={styles.plot}>
                  {onSelect ? (
                    <button
                      type="button"
                      className={`${styles.hit} ${styles.hitButton}`}
                      aria-label={`${summary}. Show these`}
                      aria-describedby={active === i ? tipId : undefined}
                      onClick={() => onSelect(d)}
                      {...hover}
                    >
                      {bar}
                    </button>
                  ) : (
                    <div className={styles.hit} role="group" aria-label={summary} {...hover}>
                      {bar}
                    </div>
                  )}
                  {active === i && (
                    <div role="tooltip" id={tipId} className={styles.tooltip} style={{ left: `${Math.max(8, (d.count / max) * 86)}%` }}>
                      <strong className={styles.tipValue}>{d.count}</strong>
                      <span className={styles.tipLabel}>
                        {' '}
                        {d.label} · {pct(d.count)}%
                      </span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

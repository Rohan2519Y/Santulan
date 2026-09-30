import { useId, useState } from 'react';
import { Table2, PieChart as PieIcon } from 'lucide-react';
import styles from './DonutChart.module.css';

const TONE_COLOR = {
  success: 'var(--c-status-success)', info: 'var(--c-status-info)', warning: 'var(--c-status-warning)', error: 'var(--c-status-error)', neutral: 'var(--c-status-neutral)',
  brightBlue: 'var(--c-bright-blue)', brightGreen: 'var(--c-bright-green)', brightPurple: 'var(--c-bright-purple)', brightOrange: 'var(--c-bright-orange)',
};
const PALETTE = ['brightBlue', 'brightGreen', 'brightPurple', 'brightOrange', 'neutral'];

/**
 * A single-ring donut for a small set of mutually-exclusive categories that sum to `total` (or to their own sum, if
 * `total` isn't given) - built as stacked SVG arc strokes on one circle, no charting library.
 *  - each segment gets a `tone` (cycling through the same five status colours BarChart/StatTile use) unless the
 *    data supplies its own
 *  - the total sits in the centre; the legend beside it carries label, count and share - colour is never the only
 *    signal
 *  - "View as table" is the non-visual alternative, same pattern as BarChart
 * `data` = [{ key, label, count, tone? }]
 */
export default function DonutChart({ data, total: totalOverride, centerLabel = 'Total', ariaLabel }) {
  const [view, setView] = useState('chart');
  const tipId = useId();
  const total = totalOverride ?? data.reduce((sum, d) => sum + d.count, 0);
  const pct = (n) => (total ? Math.round((n / total) * 100 * 10) / 10 : 0);

  if (!data.length) return null;

  const RADIUS = 60;
  const STROKE = 22;
  const CIRC = 2 * Math.PI * RADIUS;
  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = total ? d.count / total : 0;
    const arc = { ...d, tone: d.tone || PALETTE[i % PALETTE.length], length: frac * CIRC, offset };
    offset += frac * CIRC;
    return arc;
  });

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toggle} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? <Table2 size={16} aria-hidden="true" /> : <PieIcon size={16} aria-hidden="true" />}
          {view === 'chart' ? 'View as table' : 'View as chart'}
        </button>
      </div>

      {view === 'table' ? (
        <table className={styles.table}>
          <caption className="sr-only">{ariaLabel}</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead>
          <tbody>
            {data.map((d) => <tr key={d.key}><th scope="row">{d.label}</th><td>{d.count}</td><td>{pct(d.count)}%</td></tr>)}
          </tbody>
        </table>
      ) : (
        <div className={styles.layout}>
          <svg viewBox="0 0 160 160" className={styles.svg} role="img" aria-label={ariaLabel} aria-describedby={tipId}>
            <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--c-line)" strokeWidth={STROKE} />
            {arcs.map((a) => a.length > 0 && (
              <circle
                key={a.key} cx="80" cy="80" r={RADIUS} fill="none" stroke={TONE_COLOR[a.tone]} strokeWidth={STROKE}
                strokeDasharray={`${a.length} ${CIRC - a.length}`} strokeDashoffset={-a.offset + CIRC / 4}
                transform="rotate(-90 80 80)" strokeLinecap="butt"
              />
            ))}
            <text x="80" y="76" textAnchor="middle" className={styles.total}>{total}</text>
            <text x="80" y="94" textAnchor="middle" className={styles.totalLabel}>{centerLabel}</text>
          </svg>
          <ul id={tipId} className={styles.legend} aria-label={ariaLabel}>
            {arcs.map((a) => (
              <li key={a.key} className={styles.legendRow}>
                <span className={styles.swatch} style={{ background: TONE_COLOR[a.tone] }} aria-hidden="true" />
                <span className={styles.legendLabel}>{a.label}</span>
                <span className={styles.legendValue}>{a.count}<span className={styles.legendPct}> ({pct(a.count)}%)</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

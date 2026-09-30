import { useId, useState } from 'react';
import { Table2, TrendingUp } from 'lucide-react';
import styles from './LineChart.module.css';

const COLORS = ['var(--c-bright-blue)', 'var(--c-bright-purple)', 'var(--c-bright-orange)', 'var(--c-bright-green)'];
const W = 640;
const H = 220;
const PAD_L = 36;
const PAD_B = 24;
const PAD_T = 12;
const PAD_R = 12;

/**
 * A multi-series line chart over a shared date axis - plain SVG polylines, no charting library.
 * `points` = [{ date: 'YYYY-MM-DD', ... }]; `series` = [{ key, label }] (each key is read off every point).
 * Y axis is shared and starts at 0; up to 5 gridlines. "View as table" is the non-visual alternative.
 */
export default function LineChart({ points, series, ariaLabel, unit = 'count' }) {
  const [view, setView] = useState('chart');
  const tipId = useId();

  if (!points.length) return null;

  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key] || 0)));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const x = (i) => PAD_L + (points.length > 1 ? (i / (points.length - 1)) * (W - PAD_L - PAD_R) : 0);
  const y = (v) => H - PAD_B - (v / niceMax) * (H - PAD_B - PAD_T);
  const gridSteps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const tickEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toggle} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? <Table2 size={16} aria-hidden="true" /> : <TrendingUp size={16} aria-hidden="true" />}
          {view === 'chart' ? 'View as table' : 'View as chart'}
        </button>
      </div>

      {view === 'table' ? (
        <table className={styles.table}>
          <caption className="sr-only">{ariaLabel}</caption>
          <thead><tr><th scope="col">Date</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
          <tbody>
            {points.map((p) => <tr key={p.date}><th scope="row">{p.date}</th>{series.map((s) => <td key={s.key}>{p[s.key] || 0}</td>)}</tr>)}
          </tbody>
        </table>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={ariaLabel} aria-describedby={tipId}>
            {gridSteps.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className={styles.gridline} />
                <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" className={styles.axisLabel}>{v}</text>
              </g>
            ))}
            {points.map((p, i) => (i % tickEvery === 0 || i === points.length - 1) && (
              <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle" className={styles.axisLabel}>{p.date.slice(5)}</text>
            ))}
            {series.map((s, si) => (
              <polyline
                key={s.key} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2}
                points={points.map((p, i) => `${x(i)},${y(p[s.key] || 0)}`).join(' ')}
              />
            ))}
            {series.map((s, si) => points.map((p, i) => (
              <circle key={`${s.key}-${p.date}`} cx={x(i)} cy={y(p[s.key] || 0)} r={2.5} fill={COLORS[si % COLORS.length]}>
                <title>{`${p.date} · ${s.label}: ${p[s.key] || 0} ${unit}`}</title>
              </circle>
            )))}
          </svg>
          <ul id={tipId} className={styles.legend} aria-label={ariaLabel}>
            {series.map((s, si) => (
              <li key={s.key} className={styles.legendRow}>
                <span className={styles.swatch} style={{ background: COLORS[si % COLORS.length] }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

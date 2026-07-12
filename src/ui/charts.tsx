// רכיבי גרף SVG קלים, חד-סדרתיים בכוונה: זהות לפי תוויות ציר,
// לא לפי צבע — כך הגרפים נגישים גם לעיוורי צבעים בלי מקרא.

const ACCENT = 'var(--accent)';
const GRID = 'var(--border)';
const INK_MUTED = 'var(--text-muted)';

const W = 640;
const H = 240;
const M = { top: 14, right: 16, bottom: 30, left: 40 };

export interface Point {
  label: string; // תווית ציר X (תאריך וכו')
  value: number;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min = min - 1;
    max = max + 1;
  }
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const niceStep = step * mult;
  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += niceStep) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export function LineChart({
  points, unit = '', band, overlay, overlayLabel,
}: {
  points: Point[];
  unit?: string;
  band?: { from: number; to: number; label?: string }; // רצועת יעד ברקע
  overlay?: (number | null)[]; // סדרה נלווית (ממוצע נע) — קו מקווקו באותו גוון
  overlayLabel?: string;
}) {
  if (points.length < 2) {
    return <p className="muted small">צריך לפחות 2 שוטים כדי להציג מגמה.</p>;
  }
  const values = points.map((p) => p.value);
  const overlayVals = (overlay ?? []).filter((v): v is number => v !== null);
  const rawMin = Math.min(...values, ...(band ? [band.from] : []), ...overlayVals);
  const rawMax = Math.max(...values, ...(band ? [band.to] : []), ...overlayVals);
  const pad = (rawMax - rawMin) * 0.15 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (i / (points.length - 1)) * iw;
  const y = (v: number) => M.top + ih - ((v - min) / (max - min)) * ih;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = niceTicks(min, max);

  // תוויות X: ראשונה, אמצעית, אחרונה בלבד — נמנע מהתנגשויות
  const xLabelIdx = points.length <= 4
    ? points.map((_, i) => i)
    : [0, Math.floor(points.length / 2), points.length - 1];

  const overlayPath = overlay
    ? overlay
        .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
        .reduce((acc, p, i, arr) => {
          if (p === null) return acc;
          const prev = i > 0 ? arr[i - 1] : null;
          return acc + (prev === null ? `M${p}` : `L${p}`);
        }, '')
    : null;

  return (
    <div className="chart-wrap" dir="ltr">
      <svg
        className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`גרף מגמה, ${points.length} נקודות — ערך אחרון ${points[points.length - 1].value}${unit}`}
      >
        {band && (
          <g>
            <rect
              x={M.left} width={W - M.left - M.right}
              y={y(band.to)} height={Math.max(0, y(band.from) - y(band.to))}
              fill={ACCENT} opacity="0.09"
            />
            {band.label && (
              <text x={W - M.right - 4} y={y(band.to) + 13} textAnchor="end" fontSize="10" fill={INK_MUTED}>
                {band.label}
              </text>
            )}
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" opacity="0.5" />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_MUTED}>
              {t}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />
        {overlayPath && (
          <path d={overlayPath} fill="none" stroke={ACCENT} strokeWidth="2" strokeDasharray="6 5" opacity="0.65" strokeLinejoin="round" />
        )}
        {overlayPath && overlayLabel && (
          <text x={M.left + 4} y={M.top + 4} fontSize="10" fill={INK_MUTED}>
            - - {overlayLabel}
          </text>
        )}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="4" fill={ACCENT}>
            <title>{`${p.label}: ${p.value}${unit}`}</title>
          </circle>
        ))}
        {xLabelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={INK_MUTED}>
            {points[i].label}
          </text>
        ))}
        {/* תווית ערך אחרון בלבד — תווית ישירה סלקטיבית */}
        <text
          x={x(points.length - 1)} y={y(points[points.length - 1].value) - 10}
          textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)"
        >
          {points[points.length - 1].value}{unit}
        </text>
      </svg>
    </div>
  );
}

export function BarChart({ points, unit = '', maxValue }: { points: Point[]; unit?: string; maxValue?: number }) {
  if (points.length === 0) return <p className="muted small">אין נתונים עדיין.</p>;

  const rowH = 34;
  const height = points.length * rowH + 8;
  const labelW = 150;
  const valueW = 52;
  const barMax = W - labelW - valueW - 16;
  const max = maxValue ?? Math.max(...points.map((p) => p.value)) * 1.05;

  return (
    // dir=ltr כדי ש-textAnchor יתנהג עקבית; המחרוזות בעברית מוצגות נכון בזכות bidi
    <div className="chart-wrap" dir="ltr">
      <svg
        className="chart-svg" viewBox={`0 0 ${W} ${height}`} role="img"
        aria-label={`גרף השוואה: ${points.map((p) => `${p.label} ${formatVal(p.value)}${unit}`).join(', ')}`}
      >
        {points.map((p, i) => {
          const barW = Math.max(3, (p.value / max) * barMax);
          const yPos = i * rowH + 6;
          return (
            <g key={i}>
              <text x={W - 4} y={yPos + 15} textAnchor="end" fontSize="12" fill="var(--text)">
                {truncate(p.label, 20)}
              </text>
              {/* RTL: הבר גדל מימין לשמאל */}
              <rect
                x={W - labelW - 8 - barW} y={yPos} width={barW} height={20} rx="4"
                fill={ACCENT}
              >
                <title>{`${p.label}: ${p.value}${unit}`}</title>
              </rect>
              <text
                x={W - labelW - 14 - barW} y={yPos + 15}
                textAnchor="end" fontSize="12" fontWeight="700" fill="var(--text)"
              >
                {formatVal(p.value)}{unit}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// תרשים פיזור: Dose מול Yield. שוטים מוצלחים (8+) מלאים, השאר קווי מתאר —
// זהות לפי צורה ולא לפי צבע (נגיש לעיוורי צבעים).
export interface ScatterPoint {
  x: number;
  y: number;
  highlight: boolean;
  label: string;
}

export function ScatterChart({
  points, xLabel, yLabel,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
}) {
  if (points.length < 2) return <p className="muted small">צריך לפחות 2 שוטים להצגת פיזור.</p>;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.15 || 0.5;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.15 || 2;
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padY;
  const maxY = Math.max(...ys) + padY;

  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const px = (v: number) => M.left + ((v - minX) / (maxX - minX)) * iw;
  const py = (v: number) => M.top + ih - ((v - minY) / (maxY - minY)) * ih;

  const xTicks = niceTicks(minX, maxX, 5);
  const yTicks = niceTicks(minY, maxY, 4);

  return (
    <div className="chart-wrap" dir="ltr">
      <svg
        className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`תרשים פיזור: ${yLabel} מול ${xLabel}, ${points.length} שוטים`}
      >
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={py(t)} y2={py(t)} stroke={GRID} strokeWidth="1" opacity="0.5" />
            <text x={M.left - 6} y={py(t) + 4} textAnchor="end" fontSize="11" fill={INK_MUTED}>{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={px(t)} y={H - 8} textAnchor="middle" fontSize="11" fill={INK_MUTED}>{t}</text>
        ))}
        {points.map((p, i) => (
          <circle
            key={i} cx={px(p.x)} cy={py(p.y)} r={p.highlight ? 7 : 5}
            fill={p.highlight ? ACCENT : 'none'}
            stroke={ACCENT} strokeWidth="2"
            opacity={p.highlight ? 1 : 0.55}
          >
            <title>{p.label}</title>
          </circle>
        ))}
        <text x={W / 2} y={H - 22} textAnchor="middle" fontSize="10" fill={INK_MUTED}>{xLabel}</text>
        <text x={14} y={M.top - 2} fontSize="10" fill={INK_MUTED}>{yLabel}</text>
      </svg>
    </div>
  );
}

// היסטוגרמה אנכית (התפלגות דירוגים 1–10)
export function Histogram({ bins, unit = '' }: { bins: Point[]; unit?: string }) {
  if (bins.every((b) => b.value === 0)) return <p className="muted small">אין נתונים עדיין.</p>;
  const max = Math.max(...bins.map((b) => b.value));
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const barW = (iw / bins.length) * 0.72;
  const gap = iw / bins.length;

  return (
    <div className="chart-wrap" dir="ltr">
      <svg
        className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`היסטוגרמת התפלגות: ${bins.filter((b) => b.value > 0).map((b) => `${b.label}: ${b.value}${unit}`).join(', ')}`}
      >
        {bins.map((b, i) => {
          const h = max > 0 ? (b.value / max) * ih : 0;
          const cx = M.left + gap * i + gap / 2;
          return (
            <g key={b.label}>
              <rect
                x={cx - barW / 2} y={M.top + ih - h}
                width={barW} height={Math.max(h, b.value > 0 ? 3 : 0)} rx="4"
                fill={ACCENT}
              >
                <title>{`${b.label}: ${b.value}${unit}`}</title>
              </rect>
              {b.value > 0 && (
                <text x={cx} y={M.top + ih - h - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">
                  {b.value}
                </text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={INK_MUTED}>{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatVal(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

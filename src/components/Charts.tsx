'use client';
import { money } from '@/lib/util';

const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const W = 600, H = 200, L = 40, R = 8, T = 10, B = 24;

function Axes({ top }: { top: number }) {
  return (
    <>
      {[0, 0.5, 1].map((f) => {
        const y = T + (H - T - B) * (1 - f);
        return (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" />
            <text x={L - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{short(top * f)}</text>
          </g>
        );
      })}
    </>
  );
}

/** Bars, one per label. The highlighted bar (today) is solid; the rest are outlined grey. */
export function BarChart({ data, label }: { data: { label: string; value: number; today?: boolean }[]; label: string }) {
  const top = nice(Math.max(...data.map((d) => d.value), 0));
  const step = (W - L - R) / data.length;
  const bw = Math.min(step * 0.62, 36);
  const every = data.length > 12 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }}>
      <Axes top={top} />
      {data.map((d, i) => {
        const h = (H - T - B) * (d.value / top);
        const x = L + step * i + (step - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={H - B - h} width={bw} height={Math.max(h, d.value > 0 ? 1 : 0)} rx="2"
              fill={d.today ? 'var(--ink)' : 'var(--mute)'} opacity={d.today ? 1 : 0.55}><title>{`${d.label}: ${money(d.value)}`}</title></rect>
            {i % every === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mute)">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Running total of sales through the day: today (solid, stops at the current hour) against yesterday (dashed). */
export function CompareLine({ today, yesterday, nowHour }: { today: number[]; yesterday: number[]; nowHour: number }) {
  const top = nice(Math.max(...today, ...yesterday, 0));
  const x = (h: number) => L + ((W - L - R) * h) / 23;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const path = (a: number[], upTo: number) => a.slice(0, upTo + 1).map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sales through the day, today against yesterday" style={{ display: 'block' }}>
      <Axes top={top} />
      {[0, 6, 12, 18, 23].map((h) => <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mute)">{h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}</text>)}
      <path d={path(yesterday, 23)} fill="none" stroke="var(--mute)" strokeWidth="2" strokeDasharray="5 4" />
      <path d={path(today, nowHour)} fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      <circle cx={x(nowHour)} cy={y(today[nowHour] ?? 0)} r="4" fill="var(--ink)" />
    </svg>
  );
}

/** Horizontal bars for the top products. */
export function HBars({ rows }: { rows: { label: string; value: number; note: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className="hb" key={i}>
          <span className="hb-n num">{i + 1}</span>
          <div className="hb-main">
            <div className="hb-top"><span className="hb-name">{r.label}</span><span className="hb-note num mute">{r.note}</span></div>
            <div className="hb-track"><div className="hb-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

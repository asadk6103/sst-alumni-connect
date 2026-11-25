import { useMemo, useRef, useState } from 'react';

/** Small dependency-free SVG charts for reports: bar, horizontal bar, line and donut.
 * Single series use the brand colour; several series use a fixed, colour-blind-checked order (never cycled). */
export type Series = { name: string; values: number[] };
export type ChartData = { type: 'bar' | 'hbar' | 'line' | 'donut'; labels: string[]; series: Series[] };

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const colorFor = (i: number, single: boolean) => (single ? 'rgb(var(--primary))' : SERIES[i] ?? '#8a8a8a');
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function Chart({ data, height = 260 }: { data: ChartData; height?: number }) {
  if (!data.labels.length || !data.series.length) return <p className="py-10 text-center text-sm text-ink-muted">No data for this period.</p>;
  return (
    <div>
      {data.series.length > 1 && <Legend names={data.series.map((s) => s.name)} />}
      {data.type === 'line' ? <Line data={data} height={height} /> : data.type === 'hbar' ? <HBar data={data} /> : data.type === 'donut' ? <Donut data={data} /> : <Bars data={data} height={height} />}
    </div>
  );
}

function Legend({ names }: { names: string[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
      {names.map((n, i) => <li key={n} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(i, false) }} />{n}</li>)}
    </ul>
  );
}

function Tip({ x, y, title, rows }: { x: number; y: number; title: string; rows: { name: string; value: number; color: string }[] }) {
  return (
    <div className="pointer-events-none absolute z-10 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-btn border border-line bg-surface px-3 py-2 text-xs shadow-card" style={{ left: x, top: y - 8 }}>
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((r) => <p key={r.name} className="flex items-center justify-between gap-3 text-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />{r.name}</span><span className="font-medium tabular-nums text-ink">{fmt(r.value)}</span></p>)}
    </div>
  );
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const obs = useMemo(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((e) => setW(Math.max(280, e[0]!.contentRect.width)))), []);
  const set = (el: HTMLDivElement | null) => { if (ref.current && obs) obs.unobserve(ref.current); (ref as { current: HTMLDivElement | null }).current = el; if (el && obs) obs.observe(el); };
  return [set, w] as const;
}

function Axis({ max, w, h, pad }: { max: number; w: number; h: number; pad: { l: number; t: number; b: number } }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g>
      {ticks.map((t) => {
        const y = pad.t + (h - pad.t - pad.b) * (1 - t);
        return <g key={t}><line x1={pad.l} x2={w} y1={y} y2={y} stroke="rgb(var(--line))" strokeDasharray={t ? '2 4' : undefined} /><text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-ink-muted text-[10px]">{fmt(max * t)}</text></g>;
      })}
    </g>
  );
}

function Bars({ data, height }: { data: ChartData; height: number }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, t: 8, b: 34 };
  const n = data.labels.length;
  const k = data.series.length;
  const max = niceMax(Math.max(...data.series.flatMap((s) => s.values), 0));
  const band = (w - pad.l) / n;
  const gap = 2;
  const bw = Math.max(2, Math.min(36, (band * 0.7 - gap * (k - 1)) / k));
  const ih = height - pad.t - pad.b;
  const every = Math.ceil(n / Math.max(1, Math.floor((w - pad.l) / 64)));
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Bar chart">
        <Axis max={max} w={w} h={height} pad={pad} />
        {data.labels.map((label, i) => {
          const x0 = pad.l + band * i + (band - (bw * k + gap * (k - 1))) / 2;
          return (
            <g key={label + i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill={hover === i ? 'rgb(var(--primary) / 0.06)' : 'transparent'} />
              {data.series.map((s, j) => {
                const v = s.values[i] ?? 0;
                const bh = (v / max) * ih;
                const r = Math.min(4, bw / 2, bh);
                const x = x0 + j * (bw + gap);
                const y = pad.t + ih - bh;
                return bh > 0 ? <path key={s.name} fill={colorFor(j, k === 1)} d={`M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + bh}Z`} /> : null;
              })}
              {i % every === 0 && <text x={pad.l + band * i + band / 2} y={height - 14} textAnchor="middle" className="fill-ink-muted text-[10px]">{label.length > 12 ? label.slice(0, 11) + '…' : label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && <Tip x={pad.l + band * hover + band / 2} y={pad.t + ih * (1 - Math.max(...data.series.map((s) => s.values[hover] ?? 0)) / max)} title={data.labels[hover]!}
        rows={data.series.map((s, j) => ({ name: s.name, value: s.values[hover] ?? 0, color: colorFor(j, k === 1) }))} />}
    </div>
  );
}

function Line({ data, height }: { data: ChartData; height: number }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, t: 10, b: 34 };
  const n = data.labels.length;
  const max = niceMax(Math.max(...data.series.flatMap((s) => s.values), 0));
  const ih = height - pad.t - pad.b;
  const step = n > 1 ? (w - pad.l - 12) / (n - 1) : 0;
  const X = (i: number) => pad.l + 6 + i * step;
  const Y = (v: number) => pad.t + ih * (1 - v / max);
  const every = Math.ceil(n / Math.max(1, Math.floor((w - pad.l) / 70)));
  const single = data.series.length === 1;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round((e.clientX - r.left - pad.l - 6) / (step || 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Line chart">
        <Axis max={max} w={w} h={height} pad={pad} />
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgb(var(--ink-muted) / 0.4)" />}
        {data.series.map((s, j) => (
          <g key={s.name}>
            {single && <path d={`M${X(0)},${pad.t + ih} ${s.values.map((v, i) => `L${X(i)},${Y(v)}`).join(' ')} L${X(n - 1)},${pad.t + ih}Z`} fill="rgb(var(--primary) / 0.08)" />}
            <path d={s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ')} fill="none" stroke={colorFor(j, single)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && <circle cx={X(hover)} cy={Y(s.values[hover] ?? 0)} r={4.5} fill={colorFor(j, single)} stroke="rgb(var(--surface))" strokeWidth={2} />}
          </g>
        ))}
        {data.labels.map((l, i) => i % every === 0 && <text key={l + i} x={X(i)} y={height - 14} textAnchor="middle" className="fill-ink-muted text-[10px]">{l}</text>)}
      </svg>
      {hover !== null && <Tip x={X(hover)} y={Y(Math.max(...data.series.map((s) => s.values[hover] ?? 0)))} title={data.labels[hover]!}
        rows={data.series.map((s, j) => ({ name: s.name, value: s.values[hover] ?? 0, color: colorFor(j, single) }))} />}
    </div>
  );
}

function HBar({ data }: { data: ChartData }) {
  const s = data.series[0]!;
  const max = Math.max(...s.values, 1);
  return (
    <ul className="space-y-1.5" aria-label={s.name}>
      {data.labels.map((l, i) => (
        <li key={l + i} className="group grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-3 text-xs" title={`${l}: ${fmt(s.values[i] ?? 0)}`}>
          <span className="truncate text-ink">{l}</span>
          <span className="h-4 rounded-e bg-canvas"><span className="block h-full rounded-e transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(1, ((s.values[i] ?? 0) / max) * 100)}%`, background: colorFor(0, true) }} /></span>
          <span className="w-12 text-end font-medium tabular-nums text-ink">{fmt(s.values[i] ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function Donut({ data }: { data: ChartData }) {
  const s = data.series[0]!;
  const total = s.values.reduce((a, b) => a + b, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const R = 70, r = 46, C = 90;
  let a0 = -Math.PI / 2;
  const arcs = s.values.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2 - (s.values.length > 1 ? 0.02 : 0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    const d = v ? `M${p(R, a0)}A${R},${R} 0 ${big} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${big} 0 ${p(r, a0)}Z` : '';
    a0 = a1 + (s.values.length > 1 ? 0.02 : 0);
    return { d, i };
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label={s.name}>
        {arcs.map(({ d, i }) => d && <path key={i} d={d} fill={colorFor(i, false)} opacity={hover === null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />)}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-ink font-heading text-xl font-semibold">{fmt(hover === null ? total : s.values[hover]!)}</text>
        <text x={C} y={C + 16} textAnchor="middle" className="fill-ink-muted text-[10px]">{hover === null ? 'total' : `${Math.round((100 * s.values[hover]!) / total)}%`}</text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {data.labels.map((l, i) => <li key={l} className="flex items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="h-3 w-3 rounded-sm" style={{ background: colorFor(i, false) }} /><span className="text-ink">{l}</span><span className="tabular-nums text-ink-muted">{fmt(s.values[i] ?? 0)}</span></li>)}
      </ul>
    </div>
  );
}

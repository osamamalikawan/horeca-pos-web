'use client';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadDashboard, type DayStats } from '@/lib/dashboard';
import { money, qtyFmt } from '@/lib/util';
import type { Period } from '@/lib/period';
import PeriodTabs from '@/components/PeriodTabs';
import { BarChart, CompareLine, HBars } from '@/components/Charts';

const pct = (now: number, before: number) => (before === 0 ? (now === 0 ? null : 100) : ((now - before) / Math.abs(before)) * 100);
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const p = pct(now, before);
  if (p === null) return <span className="mute">{label}: none</span>;
  return <span className="mute">{p >= 0 ? '▲' : '▼'} {Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}% {label}</span>;
}

const CARDS: { key: keyof DayStats; label: string; kind: 'money' | 'num' }[] = [
  { key: 'sales', label: 'Sales', kind: 'money' },
  { key: 'net', label: 'Net sales (after returns)', kind: 'money' },
  { key: 'bills', label: 'Invoices', kind: 'num' },
  { key: 'avgBill', label: 'Average invoice', kind: 'money' },
  { key: 'units', label: 'Units sold', kind: 'num' },
  { key: 'discounts', label: 'Discounts given', kind: 'money' },
  { key: 'returns', label: 'Returns', kind: 'money' },
  { key: 'expenses', label: 'Expenses', kind: 'money' },
];

export default function DashboardPage() {
  const [view, setView] = useState<'today' | 'yesterday'>('today');
  const [topPeriod, setTopPeriod] = useState<Period>('month');
  const [tick, setTick] = useState(0);                       // re-read every minute so the day rolls over by itself
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const d = useLiveQuery(() => loadDashboard(topPeriod), [topPeriod, tick]);
  if (!d) return <div className="empty">Loading…</div>;

  const cur = view === 'today' ? d.today : d.yesterday;
  const other = view === 'today' ? d.yesterday : d.today;
  const fmt = (k: 'money' | 'num', v: number) => (k === 'money' ? money(v) : qtyFmt(v));
  const dateLabel = (offset: number) => { const x = new Date(); x.setDate(x.getDate() - offset); return x.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }); };

  return (
    <>
      <div className="head">
        <div>
          <h1>Dashboard</h1>
          <div className="mute">{view === 'today' ? `Today, ${dateLabel(0)}` : `Yesterday, ${dateLabel(1)}`}</div>
        </div>
        <div className="tools">
          <div className="seg two-seg" role="group" aria-label="Day">
            <button className={view === 'today' ? 'on' : ''} onClick={() => setView('today')}>Today</button>
            <button className={view === 'yesterday' ? 'on' : ''} onClick={() => setView('yesterday')}>Yesterday</button>
          </div>
        </div>
      </div>

      <div className="dash-cards">
        {CARDS.map((c) => (
          <div className={'stat' + (c.key === 'sales' ? ' big' : '')} key={c.key}>
            <span className="mute">{c.label}</span>
            <b className="num">{fmt(c.kind, cur[c.key])}</b>
            <span className="num" style={{ fontSize: 12 }}>
              {view === 'today'
                ? <Delta now={cur[c.key]} before={other[c.key]} label={`vs yesterday ${fmt(c.kind, other[c.key])}`} />
                : <span className="mute">Today so far: {fmt(c.kind, other[c.key])}</span>}
            </span>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Today and yesterday</h2>
          <span className="legend"><i className="ln solid" /> Today <i className="ln dashed" /> Yesterday</span>
        </div>
        <CompareLine today={d.hourly.today} yesterday={d.hourly.yesterday} nowHour={d.hourly.nowHour} />
        <div className="mute" style={{ fontSize: 12 }}>Running total of sales through the day.</div>
      </section>

      <div className="dash-two">
        <section className="panel">
          <div className="panel-head">
            <h2>Weekly sales</h2>
            <span className="num"><b>{money(d.week.total)}</b></span>
          </div>
          <BarChart data={d.week.days} label="Sales for each of the last 7 days" />
          <div className="num" style={{ fontSize: 12 }}><Delta now={d.week.total} before={d.week.prevTotal} label={`vs the 7 days before (${money(d.week.prevTotal)})`} /></div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Monthly sales, {d.month.name}</h2>
            <span className="num"><b>{money(d.month.total)}</b></span>
          </div>
          <BarChart data={d.month.days} label="Sales for each day of this month" />
          <div className="num" style={{ fontSize: 12 }}><Delta now={d.month.total} before={d.month.prevTotal} label={`vs the same days of ${d.month.prevName} (${money(d.month.prevTotal)})`} /></div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Top 10 selling products</h2>
          <PeriodTabs value={topPeriod} onChange={setTopPeriod} />
        </div>
        {d.top.length === 0
          ? <div className="empty">No sales in this period.</div>
          : <HBars rows={d.top.map((p) => ({ label: p.name, value: p.qty, note: `${qtyFmt(p.qty)} sold, ${money(p.revenue)}` }))} />}
        <div className="mute" style={{ fontSize: 12 }}>Ranked by units sold. Cancelled sales are left out; returns are not subtracted.</div>
      </section>
    </>
  );
}

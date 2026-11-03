import { db } from './db';
import { round2 } from './util';
import { periodStartMs, type Period } from './period';

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sum = (a: number[]) => round2(a.reduce((s, v) => s + v, 0));

export interface DayStats {
  sales: number; returns: number; net: number; bills: number; avgBill: number; units: number; discounts: number; expenses: number;
}
export interface TopProduct { product_id: string; name: string; qty: number; revenue: number }
export interface DashData {
  today: DayStats; yesterday: DayStats;
  hourly: { today: number[]; yesterday: number[]; nowHour: number };          // cumulative sales by hour
  week: { days: { label: string; value: number; today: boolean }[]; total: number; prevTotal: number };
  month: { days: { label: string; value: number; today: boolean }[]; total: number; prevTotal: number; name: string; prevName: string };
  top: TopProduct[];
}

/** Everything the dashboard shows, from the local database (works offline). Cancelled sales are left out. */
export async function loadDashboard(topPeriod: Period): Promise<DashData> {
  const now = new Date();
  const t0 = dayStart(now), y0 = addDays(t0, -1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const since = topPeriod === 'all' ? 0 : Math.min(prevMonthStart.getTime(), addDays(t0, -13).getTime(), periodStartMs(topPeriod));
  const sinceIso = new Date(since).toISOString();

  const [inv, rets, exps] = await Promise.all([
    topPeriod === 'all' ? db.invoices.toArray() : db.invoices.where('created_at').aboveOrEqual(sinceIso).toArray(),
    db.sale_returns.where('created_at').aboveOrEqual(y0.toISOString()).toArray(),
    db.expenses.filter((e) => !e.deleted_at).toArray(),
  ]);
  const live = inv.filter((i) => !i.deleted_at && !i.cancelled_at);
  const ms = (iso: string) => new Date(iso).getTime();

  // items are only needed for units (today, yesterday) and the top products period
  const itemFrom = Math.min(y0.getTime(), topPeriod === 'all' ? 0 : periodStartMs(topPeriod));
  const itemInv = live.filter((i) => ms(i.created_at) >= itemFrom);
  const items = itemInv.length ? await db.invoice_items.where('invoice_id').anyOf(itemInv.map((i) => i.id)).toArray() : [];
  const invTime = new Map(live.map((i) => [i.id, ms(i.created_at)]));

  const inRange = (t: number, a: Date, b: Date) => t >= a.getTime() && t < b.getTime();
  const stats = (a: Date, b: Date): DayStats => {
    const iv = live.filter((i) => inRange(ms(i.created_at), a, b));
    const sales = sum(iv.map((i) => Number(i.total)));
    const returns = sum(rets.filter((r) => !r.deleted_at && inRange(ms(r.created_at), a, b)).map((r) => Number(r.total)));
    const units = sum(items.filter((it) => inRange(invTime.get(it.invoice_id) ?? -1, a, b)).map((it) => Number(it.qty)));
    return {
      sales, returns, net: round2(sales - returns), bills: iv.length, avgBill: iv.length ? round2(sales / iv.length) : 0, units,
      discounts: sum(iv.map((i) => Number(i.discount_total))),
      expenses: sum(exps.filter((e) => inRange(ms(e.spent_at || e.created_at), a, b)).map((e) => Number(e.amount))),
    };
  };
  const today = stats(t0, addDays(t0, 1)), yesterday = stats(y0, t0);

  const cumulative = (a: Date) => {
    const by = new Array(24).fill(0);
    live.filter((i) => inRange(ms(i.created_at), a, addDays(a, 1))).forEach((i) => { by[new Date(i.created_at).getHours()] += Number(i.total); });
    let run = 0; return by.map((v) => (run = round2(run + v)));
  };

  const daily = (from: Date, n: number) => Array.from({ length: n }, (_, k) => {
    const a = addDays(from, k);
    return { a, value: sum(live.filter((i) => inRange(ms(i.created_at), a, addDays(a, 1))).map((i) => Number(i.total))) };
  });
  const wk = daily(addDays(t0, -6), 7), pwk = daily(addDays(t0, -13), 7);
  const weekDays = wk.map((d) => ({ label: d.a.toLocaleDateString([], { weekday: 'short' }), value: d.value, today: d.a.getTime() === t0.getTime() }));

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const mo = daily(monthStart, dim);
  const monthDays = mo.map((d) => ({ label: String(d.a.getDate()), value: d.a.getTime() > t0.getTime() ? 0 : d.value, today: d.a.getTime() === t0.getTime() }));
  const prevMo = daily(prevMonthStart, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));   // same days of last month

  const topFrom = topPeriod === 'all' ? 0 : periodStartMs(topPeriod);
  const agg = new Map<string, TopProduct>();
  items.filter((it) => (invTime.get(it.invoice_id) ?? -1) >= topFrom).forEach((it) => {
    const r = agg.get(it.product_id) ?? { product_id: it.product_id, name: it.name, qty: 0, revenue: 0 };
    r.qty = round2(r.qty + Number(it.qty)); r.revenue = round2(r.revenue + Number(it.line_total)); r.name = it.name;
    agg.set(it.product_id, r);
  });
  const top = [...agg.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10);

  return {
    today, yesterday,
    hourly: { today: cumulative(t0), yesterday: cumulative(y0), nowHour: now.getHours() },
    week: { days: weekDays, total: sum(wk.map((d) => d.value)), prevTotal: sum(pwk.map((d) => d.value)) },
    month: {
      days: monthDays, total: sum(monthDays.map((d) => d.value)), prevTotal: sum(prevMo.map((d) => d.value)),
      name: monthStart.toLocaleDateString([], { month: 'long' }), prevName: prevMonthStart.toLocaleDateString([], { month: 'long' }),
    },
    top,
  };
}

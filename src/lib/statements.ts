import { db } from './db';
import { round2 } from './util';

export type PartyKind = 'customer' | 'supplier' | 'employee';
export interface StatementRow { id: string; at: string; ord: string; label: string; ref: string; note: string; plus: number; minus: number }   // ord breaks ties between entries with the same time
export interface Statement {
  kind: PartyKind; name: string; phone: string | null;
  rows: (StatementRow & { balance: number })[];
  opening: number; closing: number; totalPlus: number; totalMinus: number;
  plusLabel: string; minusLabel: string; balanceLabel: string;
}

const nz = (v: unknown) => Number(v ?? 0) || 0;
const LABELS: Record<PartyKind, { plus: string; minus: string; balance: string }> = {
  customer: { plus: 'Billed', minus: 'Received or returned', balance: 'Customer owes you' },
  supplier: { plus: 'Purchased', minus: 'Paid or returned', balance: 'You owe supplier' },
  employee: { plus: 'Earned', minus: 'Paid or deducted', balance: 'You owe employee' },
};

async function customerRows(id: string): Promise<StatementRow[]> {
  const [inv, tx, rets] = await Promise.all([
    db.invoices.filter((i) => i.party_id === id && !i.deleted_at && !i.cancelled_at).toArray(),
    db.transactions.filter((t) => t.party_id === id && !t.deleted_at && (t.type === 'sale' || t.type === 'receipt')).toArray(),
    db.sale_returns.filter((r) => r.party_id === id && !r.deleted_at).toArray(),
  ]);
  const live = new Set(inv.map((i) => i.id));
  const rows: StatementRow[] = [];
  inv.forEach((i) => rows.push({ id: i.id, at: i.created_at, ord: i.updated_at, label: 'Invoice', ref: i.invoice_no, note: '', plus: nz(i.total), minus: 0 }));
  tx.forEach((t) => {
    if (t.type === 'sale' && !(t.ref_id && live.has(t.ref_id))) return;
    rows.push({ id: t.id, at: t.created_at, ord: t.updated_at, label: t.type === 'sale' ? 'Paid at sale' : 'Payment received', ref: t.type === 'sale' ? t.note ?? '' : '', note: t.type === 'sale' ? '' : t.note ?? '', plus: 0, minus: nz(t.amount) });
  });
  rets.forEach((r) => {
    rows.push({ id: r.id, at: r.created_at, ord: r.updated_at, label: 'Return', ref: r.return_no, note: r.note ?? '', plus: 0, minus: nz(r.total) });
    if (nz(r.cash_refund) > 0) rows.push({ id: r.id + ':refund', at: r.created_at, ord: r.updated_at + '~', label: 'Refund paid back', ref: r.return_no, note: '', plus: nz(r.cash_refund), minus: 0 });
  });
  return rows;
}

async function supplierRows(id: string): Promise<StatementRow[]> {
  const [pur, tx, rets] = await Promise.all([
    db.purchases.filter((p) => p.party_id === id && !p.deleted_at).toArray(),
    db.transactions.filter((t) => t.party_id === id && !t.deleted_at && (t.type === 'purchase' || t.type === 'payment')).toArray(),
    db.purchase_returns.filter((r) => r.party_id === id && !r.deleted_at).toArray(),
  ]);
  const rows: StatementRow[] = [];
  pur.forEach((p) => rows.push({ id: p.id, at: p.created_at, ord: p.updated_at, label: 'Purchase', ref: p.purchase_no, note: p.bill_no ? `Bill ${p.bill_no}` : '', plus: nz(p.total), minus: 0 }));
  tx.forEach((t) => rows.push({ id: t.id, at: t.created_at, ord: t.updated_at, label: t.type === 'purchase' ? 'Paid at purchase' : 'Payment', ref: t.type === 'purchase' ? t.note ?? '' : '', note: t.type === 'purchase' ? '' : t.note ?? '', plus: 0, minus: nz(t.amount) }));
  rets.forEach((r) => {
    rows.push({ id: r.id, at: r.created_at, ord: r.updated_at, label: 'Purchase return', ref: r.return_no, note: r.note ?? '', plus: 0, minus: nz(r.total) });
    if (nz(r.cash_refund) > 0) rows.push({ id: r.id + ':refund', at: r.created_at, ord: r.updated_at + '~', label: 'Refund received', ref: r.return_no, note: '', plus: nz(r.cash_refund), minus: 0 });
  });
  return rows;
}

async function employeeRows(id: string): Promise<StatementRow[]> {
  const entries = await db.employee_entries.filter((e) => e.employee_id === id && !e.deleted_at).toArray();
  const names: Record<string, string> = { salary: 'Salary', bonus: 'Bonus', deduction: 'Deduction', advance: 'Advance', payment: 'Salary paid' };
  return entries.map((e) => {
    const up = e.kind === 'salary' || e.kind === 'bonus';
    return { id: e.id, at: e.created_at, ord: e.updated_at, label: names[e.kind] ?? e.kind, ref: e.kind === 'salary' && e.month ? e.month : '', note: e.note ?? '', plus: up ? nz(e.amount) : 0, minus: up ? 0 : nz(e.amount) };
  });
}

/** from / to are local dates 'YYYY-MM-DD' (either may be empty). Earlier entries roll into the opening balance. */
export async function loadStatement(kind: PartyKind, id: string, from?: string | null, to?: string | null): Promise<Statement | null> {
  let name = '', phone: string | null = null, opening = 0;
  if (kind === 'employee') {
    const e = await db.employees.get(id); if (!e) return null;
    name = e.name; phone = e.phone; opening = nz(e.opening_balance);
  } else {
    const p = await db.parties.get(id); if (!p) return null;
    name = p.name; phone = p.phone; opening = nz(p.opening_balance);
  }
  const all = await (kind === 'customer' ? customerRows(id) : kind === 'supplier' ? supplierRows(id) : employeeRows(id));
  all.sort((a, b) => a.at.localeCompare(b.at) || a.ord.localeCompare(b.ord));
  const fromMs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
  const toMs = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
  let bal = opening;
  all.filter((r) => new Date(r.at).getTime() < fromMs).forEach((r) => { bal += r.plus - r.minus; });
  const openingAtStart = round2(bal);
  const rows = all.filter((r) => { const t = new Date(r.at).getTime(); return t >= fromMs && t <= toMs; })
    .map((r) => { bal += r.plus - r.minus; return { ...r, balance: round2(bal) }; });
  const L = LABELS[kind];
  return {
    kind, name, phone, rows, opening: openingAtStart, closing: round2(bal),
    totalPlus: round2(rows.reduce((s, r) => s + r.plus, 0)), totalMinus: round2(rows.reduce((s, r) => s + r.minus, 0)),
    plusLabel: L.plus, minusLabel: L.minus, balanceLabel: L.balance,
  };
}

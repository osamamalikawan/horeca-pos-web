import { db } from './db';

const nz = (v: unknown) => Number(v ?? 0) || 0;

/** What each customer still owes: opening balance, unpaid invoices, minus payments received and return credits. */
export async function customerBalances() {
  const [parties, inv, rec, rets] = await Promise.all([
    db.parties.filter((p) => p.type === 'customer' && !p.deleted_at).toArray(),
    db.invoices.filter((i) => !i.deleted_at && !i.cancelled_at && !!i.party_id).toArray(),
    db.transactions.filter((t) => !t.deleted_at && t.type === 'receipt' && !!t.party_id).toArray(),
    db.sale_returns.filter((r) => !r.deleted_at && !!r.party_id).toArray(),
  ]);
  const b: Record<string, number> = {};
  parties.forEach((p) => { if (nz(p.opening_balance)) b[p.id] = nz(p.opening_balance); });
  inv.forEach((i) => { b[i.party_id!] = (b[i.party_id!] ?? 0) + nz(i.total) - nz(i.paid); });
  rec.forEach((t) => { b[t.party_id!] = (b[t.party_id!] ?? 0) - nz(t.amount); });
  rets.forEach((r) => { b[r.party_id!] = (b[r.party_id!] ?? 0) - nz(r.credit_adjust); });
  return b;
}

/** What we still owe each supplier: opening balance, unpaid purchases, minus later payments. */
export async function supplierBalances() {
  const [parties, pur, pay, rets] = await Promise.all([
    db.parties.filter((p) => p.type === 'supplier' && !p.deleted_at).toArray(),
    db.purchases.filter((p) => !p.deleted_at && !p.cancelled_at && !!p.party_id).toArray(),
    db.transactions.filter((t) => !t.deleted_at && t.type === 'payment' && !!t.party_id).toArray(),
    db.purchase_returns.filter((r) => !r.deleted_at && !!r.party_id).toArray(),
  ]);
  const b: Record<string, number> = {};
  parties.forEach((p) => { if (nz(p.opening_balance)) b[p.id] = nz(p.opening_balance); });
  pur.forEach((p) => { b[p.party_id!] = (b[p.party_id!] ?? 0) + nz(p.total) - nz(p.paid); });
  pay.forEach((t) => { b[t.party_id!] = (b[t.party_id!] ?? 0) - nz(t.amount); });
  rets.forEach((r) => { b[r.party_id!] = (b[r.party_id!] ?? 0) - nz(r.credit_adjust); });
  return b;
}

/** What we owe each employee (negative: the employee owes us, e.g. an advance not yet earned). */
export async function employeeBalances() {
  const [emps, entries] = await Promise.all([
    db.employees.filter((e) => !e.deleted_at).toArray(),
    db.employee_entries.filter((e) => !e.deleted_at).toArray(),
  ]);
  const b: Record<string, number> = {};
  emps.forEach((e) => { b[e.id] = nz(e.opening_balance); });
  entries.forEach((e) => {
    const sign = e.kind === 'salary' || e.kind === 'bonus' ? 1 : -1;
    b[e.employee_id] = (b[e.employee_id] ?? 0) + sign * nz(e.amount);
  });
  return b;
}

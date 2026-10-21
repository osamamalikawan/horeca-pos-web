import { db, putRow } from './db';
import { uid } from './util';
import type { EmployeeEntryKind } from './types';

/**
 * Record a salary entry. Advances and salary payments move money out of an account;
 * the other kinds (salary due, bonus, deduction) only change what is owed.
 */
export async function addEmployeeEntry(a: {
  employeeId: string; kind: EmployeeEntryKind; amount: number; month?: string | null; accountId?: string | null; note?: string;
}) {
  const moves = a.kind === 'advance' || a.kind === 'payment';
  if (moves && !a.accountId) throw new Error('Choose the account the money is paid from.');
  if (!(a.amount > 0)) throw new Error('Enter an amount above zero.');
  const now = new Date().toISOString();
  const id = uid();
  await db.transaction('rw', db.tables, async () => {
    await putRow('employee_entries', {
      id, employee_id: a.employeeId, kind: a.kind, amount: a.amount, month: a.kind === 'salary' ? a.month ?? null : null,
      account_id: moves ? a.accountId : null, note: a.note?.trim() || null, created_at: now, deleted_at: null,
    });
    if (moves) {
      await putRow('transactions', {
        id: uid(), account_id: a.accountId, direction: 'out', amount: a.amount,
        type: a.kind === 'advance' ? 'advance' : 'salary', party_id: null, ref_id: id,
        note: a.note?.trim() || (a.kind === 'advance' ? 'Advance' : 'Salary'), created_at: now, deleted_at: null,
      });
    }
  });
}

export async function removeEmployeeEntry(entryId: string) {
  const now = new Date().toISOString();
  await db.transaction('rw', db.tables, async () => {
    const e = await db.employee_entries.get(entryId);
    if (e) await putRow('employee_entries', { ...e, deleted_at: now });
    const txs = await db.transactions.where('ref_id').equals(entryId).filter((t) => !t.deleted_at).toArray();
    for (const t of txs) await putRow('transactions', { ...t, deleted_at: now });
  });
}

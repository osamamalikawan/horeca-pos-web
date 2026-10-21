'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money, uid } from '@/lib/util';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import PeriodTabs from '@/components/PeriodTabs';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';

const CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Supplies', 'Transport', 'Maintenance', 'Other'];
const localDate = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Form { id: string | null; category: string; amount: string; accountId: string; note: string; date: string; origDate: string; origSpent: string }

export default function ExpensesPage() {
  const canEdit = useProfile().can('expenses.edit');
  const expenses = useLiveQuery(() => db.expenses.filter((e) => !e.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const [period, setPeriod] = useState<Period>('month');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');

  const accName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const rows = useMemo(
    () => (expenses ?? []).filter((e) => inPeriod(e.spent_at, period)).sort((a, b) => b.spent_at.localeCompare(a.spent_at)),
    [expenses, period],
  );
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);
  const categories = useMemo(
    () => Array.from(new Set([...CATEGORIES, ...(expenses ?? []).map((e) => e.category)])),
    [expenses],
  );

  function openNew() {
    setError('');
    const d = localDate();
    setForm({ id: null, category: '', amount: '', accountId: defaultAccountId(accounts), note: '', date: d, origDate: d, origSpent: '' });
  }
  function openEdit(e: NonNullable<typeof expenses>[number]) {
    setError('');
    setForm({ id: e.id, category: e.category, amount: String(e.amount), accountId: e.account_id, note: e.note ?? '',
      date: localDate(e.spent_at), origDate: localDate(e.spent_at), origSpent: e.spent_at });
  }

  async function save() {
    if (!form) return;
    const amount = Number(form.amount);
    const category = form.category.trim();
    const accountId = form.accountId || defaultAccountId(accounts);
    if (!category) return setError('Enter a category.');
    if (!isFinite(amount) || amount <= 0) return setError('Enter an amount above zero.');
    if (!accountId) return setError('Accounts are not loaded yet. Press Sync now once while online.');
    const spent = form.id && form.date === form.origDate ? form.origSpent
      : form.date === localDate() ? new Date().toISOString() : new Date(form.date + 'T12:00:00').toISOString();
    const id = form.id ?? uid();
    const note = form.note.trim() || null;
    await db.transaction('rw', [db.expenses, db.transactions, db.outbox], async () => {
      const cur = form.id ? await db.expenses.get(id) : undefined;
      await putRow('expenses', {
        ...(cur ?? { id, created_at: new Date().toISOString(), deleted_at: null }),
        category, amount, account_id: accountId, note, spent_at: spent,
      });
      const tx = form.id ? (await db.transactions.filter((t) => t.ref_id === id && t.type === 'expense' && !t.deleted_at).toArray())[0] : undefined;
      await putRow('transactions', {
        ...(tx ?? { id: uid(), created_at: spent, deleted_at: null, party_id: null, type: 'expense', direction: 'out', ref_id: id }),
        account_id: accountId, amount, note: note ?? category, created_at: spent,
      });
    });
    setForm(null);
  }

  async function remove() {
    if (!form?.id) return;
    const id = form.id;
    const now = new Date().toISOString();
    await db.transaction('rw', [db.expenses, db.transactions, db.outbox], async () => {
      const cur = await db.expenses.get(id);
      if (cur) await putRow('expenses', { ...cur, deleted_at: now });
      const txs = await db.transactions.filter((t) => t.ref_id === id && t.type === 'expense' && !t.deleted_at).toArray();
      for (const t of txs) await putRow('transactions', { ...t, deleted_at: now });
    });
    setForm(null);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Expenses</h1>
          <div className="mute num">{rows.length} {rows.length === 1 ? 'expense' : 'expenses'}, {money(total)}</div>
        </div>
        <div className="tools">
          <PeriodTabs value={period} onChange={setPeriod} />
          {canEdit && <button className="btn primary" onClick={openNew}>Add expense</button>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No expenses in this period. Choose Add expense to record one.</div>
      ) : (
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Paid from</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} onClick={() => canEdit && openEdit(e)}>
                <td className="num mute">{shortDate(e.spent_at)}</td>
                <td>{e.category}</td>
                <td className="mute">{e.note ?? ''}</td>
                <td>{accName.get(e.account_id) ?? ''}</td>
                <td className="right num">{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit expense' : 'New expense'}
        footer={form && (
          <>
            {form.id ? <button className="btn danger" onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary" onClick={save}>Save expense</button>
            </span>
          </>
        )}>
        {form && (
          <>
            <label>Category
              <input list="expense-cats" value={form.category} autoFocus onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="expense-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <div className="two">
              <label>Amount<input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label>Date<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            </div>
            <label>Paid from
              <AccountPicker accounts={accounts} value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} />
            </label>
            <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {error && <div className="err">{error}</div>}
          </>
        )}
      </Drawer>
    </>
  );
}

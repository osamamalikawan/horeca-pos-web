'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money } from '@/lib/util';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import type { Account } from '@/lib/types';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import PeriodTabs from '@/components/PeriodTabs';
import { sortAccounts } from '@/components/AccountPicker';

const TYPE_LABEL: Record<string, string> = {
  sale: 'Sale', expense: 'Expense', receipt: 'Payment received', payment: 'Payment made',
  purchase: 'Purchase', refund: 'Sale return refund', purchase_refund: 'Purchase return refund', salary: 'Salary paid', advance: 'Employee advance',
};

export default function AccountsPage() {
  const canEdit = useProfile().can('accounts.edit');
  const data = useLiveQuery(async () => {
    const [accounts, tx, invoices, expenses, parties, returns] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.filter((t) => !t.deleted_at).toArray(),
      db.invoices.filter((i) => !i.deleted_at && !i.cancelled_at).toArray(),
      db.expenses.filter((e) => !e.deleted_at).toArray(),
      db.parties.toArray(),
      db.sale_returns.filter((r) => !r.deleted_at).toArray(),
    ]);
    return { accounts, tx, invoices, expenses, parties, returns };
  }, []);

  const [period, setPeriod] = useState<Period>('month');
  const [filter, setFilter] = useState<string>('all');
  const [edit, setEdit] = useState<{ acc: Account; value: string } | null>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const { accounts, tx, invoices, expenses, parties, returns } = data;
    const per = accounts.map((a) => {
      const mine = tx.filter((t) => t.account_id === a.id);
      const inAll = mine.filter((t) => t.direction === 'in').reduce((s, t) => s + Number(t.amount), 0);
      const outAll = mine.filter((t) => t.direction === 'out').reduce((s, t) => s + Number(t.amount), 0);
      const p = mine.filter((t) => inPeriod(t.created_at, period));
      return {
        a, balance: Number(a.opening_balance) + inAll - outAll,
        inP: p.filter((t) => t.direction === 'in').reduce((s, t) => s + Number(t.amount), 0),
        outP: p.filter((t) => t.direction === 'out').reduce((s, t) => s + Number(t.amount), 0),
      };
    });
    const salesRows = invoices.filter((i) => inPeriod(i.created_at, period));
    const sales = salesRows.reduce((s, i) => s + Number(i.total), 0);
    const exp = expenses.filter((e) => inPeriod(e.spent_at, period)).reduce((s, e) => s + Number(e.amount), 0);
    const owedBy: Record<string, number> = {};
    invoices.forEach((i) => { if (i.party_id) owedBy[i.party_id] = (owedBy[i.party_id] ?? 0) + Number(i.total) - Number(i.paid); });
    tx.forEach((t) => { if (t.type === 'receipt' && t.party_id) owedBy[t.party_id] = (owedBy[t.party_id] ?? 0) - Number(t.amount); });
    returns.forEach((r) => { if (r.party_id) owedBy[r.party_id] = (owedBy[r.party_id] ?? 0) - Number(r.credit_adjust); });
    const retTotal = returns.filter((r) => inPeriod(r.created_at, period)).reduce((s, r) => s + Number(r.total), 0);
    parties.forEach((p) => { if (p.type === 'customer' && !p.deleted_at && Number(p.opening_balance)) owedBy[p.id] = (owedBy[p.id] ?? 0) + Number(p.opening_balance); });
    const empPaid = tx.filter((t) => (t.type === 'salary' || t.type === 'advance') && inPeriod(t.created_at, period)).reduce((s, t) => s + Number(t.amount), 0);
    const receivable = Object.values(owedBy).reduce((s, v) => s + Math.max(v, 0), 0);
    const partyName = new Map(parties.map((p) => [p.id, p.name]));
    const accName = new Map(accounts.map((a) => [a.id, a.name]));
    const list = tx
      .filter((t) => inPeriod(t.created_at, period) && (filter === 'all' || t.account_id === filter))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 300);
    return { retTotal, empPaid, per: per.sort((x, y) => sortAccounts([x.a, y.a])[0] === x.a ? -1 : 1), sales, salesCount: salesRows.length, exp, receivable, list, partyName, accName };
  }, [data, period, filter]);

  async function saveOpening() {
    if (!edit) return;
    const v = Number(edit.value || 0);
    if (!isFinite(v)) return;
    await putRow('accounts', { ...edit.acc, opening_balance: v });
    setEdit(null);
  }

  if (!view) return null;
  if (data && data.accounts.length === 0) {
    return <div className="empty">Accounts are not loaded yet. Connect to the internet and press Sync now once.</div>;
  }
  const cashTotal = view.per.reduce((s, p) => s + p.balance, 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Accounts</h1>
          <div className="mute num">Money across all accounts: {money(cashTotal)}</div>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      <div className="cards">
        <div className="card"><span className="sub">Total sales</span><span className="big num">{money(view.sales)}</span><span className="sub num">{view.salesCount} {view.salesCount === 1 ? 'invoice' : 'invoices'}</span></div>
        <div className="card"><span className="sub">Total expenses</span><span className="big num">{money(view.exp)}</span></div>
        <div className="card"><span className="sub">Sales returns</span><span className="big num">{money(view.retTotal)}</span></div>
        <div className="card"><span className="sub">Salaries and advances paid</span><span className="big num">{money(view.empPaid)}</span></div>
        <div className="card"><span className="sub">Sales minus returns, expenses and salaries</span><span className="big num">{money(view.sales - view.retTotal - view.exp - view.empPaid)}</span></div>
        <div className="card"><span className="sub">Customers owe</span><span className="big num">{money(view.receivable)}</span></div>
      </div>

      <div className="cards">
        {view.per.map(({ a, balance, inP, outP }) => (
          <button key={a.id} className={'card ' + (filter === a.id ? 'on' : '')} onClick={() => setFilter(filter === a.id ? 'all' : a.id)}>
            <span className="sub">{a.name}</span>
            <span className={'big num ' + (balance < 0 ? 'warn' : '')}>{money(balance)}</span>
            <span className="sub num">In {money(inP)}, out {money(outP)}</span>
            <span className="sub" role="button" tabIndex={0} style={{ textDecoration: 'underline' }}
              onClick={(e) => { e.stopPropagation(); if (canEdit) setEdit({ acc: a, value: String(a.opening_balance) }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (canEdit) setEdit({ acc: a, value: String(a.opening_balance) }); } }}>
              Opening balance {money(a.opening_balance)}
            </span>
          </button>
        ))}
      </div>

      <div className="head">
        <h2>Transactions{filter !== 'all' ? `, ${view.accName.get(filter)}` : ''}</h2>
        {filter !== 'all' && <button className="btn small quiet" onClick={() => setFilter('all')}>Show all accounts</button>}
      </div>
      {view.list.length === 0 ? (
        <div className="empty">No transactions in this period.</div>
      ) : (
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Account</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {view.list.map((t) => (
              <tr key={t.id} style={{ cursor: 'default' }}>
                <td className="num mute">{shortDate(t.created_at)}</td>
                <td>{TYPE_LABEL[t.type] ?? t.type}</td>
                <td className="mute">{[t.party_id ? view.partyName.get(t.party_id) : null, t.note].filter(Boolean).join(', ')}</td>
                <td>{view.accName.get(t.account_id) ?? ''}</td>
                <td className="right num">{t.direction === 'in' ? '' : '-'}{money(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.acc.name} opening balance` : ''}
        footer={<><span /><span style={{ display: 'flex', gap: 8 }}>
          <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn primary" onClick={saveOpening}>Save</button></span></>}>
        {edit && (
          <>
            <p className="mute" style={{ margin: 0 }}>The money already in this account before you started using the POS. The balance adds sales and receipts and subtracts expenses and payments made.</p>
            <label>Opening balance<input inputMode="decimal" autoFocus value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></label>
          </>
        )}
      </Drawer>
    </>
  );
}

'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money, round2, uid } from '@/lib/util';
import { shortDate } from '@/lib/period';
import { customerBalances } from '@/lib/ledger';
import { loadStatement } from '@/lib/statements';
import type { Party } from '@/lib/types';
import Drawer from '@/components/Drawer';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';
import MigrationNotice from '@/components/MigrationNotice';
import { useProfile } from '@/components/ProfileProvider';

interface Form {
  id: string | null; name: string; phone: string; company: string; address: string;
  is_business: boolean; credit_limit: string; opening_balance: string;
}
const blank: Form = { id: null, name: '', phone: '', company: '', address: '', is_business: false, credit_limit: '', opening_balance: '' };

export default function CustomersPage() {
  const { can, legacy } = useProfile();
  const canEdit = can('customers.edit') && !legacy;
  const customers = useLiveQuery(() => db.parties.filter((p) => p.type === 'customer' && !p.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const owed = useLiveQuery(() => customerBalances(), []);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'b2b' | 'retail'>('all');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [rec, setRec] = useState<{ amount: string; accountId: string; note: string } | null>(null);
  const stmt = useLiveQuery(() => (form?.id ? loadStatement('customer', form.id) : undefined), [form?.id]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (customers ?? [])
      .filter((p) => filter === 'all' || (filter === 'b2b' ? p.is_business : !p.is_business))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone ?? '').includes(s) || (p.company ?? '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, q, filter]);
  const totalOwed = round2(list.reduce((s, p) => s + Math.max(owed?.[p.id] ?? 0, 0), 0));

  function openNew() { setError(''); setRec(null); setForm({ ...blank }); }
  function openEdit(p: Party) {
    setError(''); setRec(null);
    setForm({ id: p.id, name: p.name, phone: p.phone ?? '', company: p.company ?? '', address: p.address ?? '', is_business: !!p.is_business,
      credit_limit: p.credit_limit ? String(p.credit_limit) : '', opening_balance: p.opening_balance ? String(p.opening_balance) : '' });
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    const credit = Number(form.credit_limit || 0), opening = Number(form.opening_balance || 0);
    if (!name) return setError('Enter the customer name.');
    if (!isFinite(credit) || credit < 0) return setError('Credit limit must be a number, or empty.');
    if (!isFinite(opening)) return setError('Opening balance must be a number, or empty.');
    if (Math.abs(opening) >= 1e9 || credit >= 1e9) return setError('That number is too large.');
    const cur = form.id ? await db.parties.get(form.id) : undefined;
    const id = cur?.id ?? uid();
    await putRow('parties', {
      ...(cur ?? { id, type: 'customer', created_at: new Date().toISOString(), deleted_at: null }),
      name, phone: form.phone.trim() || null, company: form.company.trim() || null, address: form.address.trim() || null,
      is_business: form.is_business, credit_limit: credit, opening_balance: opening,
    });
    if (!form.id) setForm({ ...form, id }); else setForm(null);
  }

  async function remove() {
    if (!form?.id || !window.confirm('Delete this customer? Past invoices stay in the records.')) return;
    const cur = await db.parties.get(form.id);
    if (cur) await putRow('parties', { ...cur, deleted_at: new Date().toISOString() });
    setForm(null);
  }

  async function saveReceipt() {
    if (!form?.id || !rec) return;
    const amount = Number(rec.amount);
    const accountId = rec.accountId || defaultAccountId(accounts);
    if (!isFinite(amount) || amount <= 0) return setError('Enter an amount above zero.');
    if (!accountId) return setError('Accounts are not loaded yet. Press Sync now once while online.');
    await putRow('transactions', {
      id: uid(), account_id: accountId, direction: 'in', amount, type: 'receipt', party_id: form.id, ref_id: null,
      note: rec.note.trim() || null, created_at: new Date().toISOString(), deleted_at: null,
    });
    setRec(null); setError('');
  }

  const balance = form?.id ? owed?.[form.id] ?? 0 : 0;
  const limit = Number(form?.credit_limit || 0);

  return (
    <>
      {legacy && <MigrationNotice />}
      <div className="head">
        <div>
          <h1>Customers</h1>
          <div className="mute num">{list.length} {list.length === 1 ? 'customer' : 'customers'}, they owe you {money(totalOwed)}</div>
        </div>
        <div className="tools">
          <div className="seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
            {(['all', 'b2b', 'retail'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} style={{ padding: '0 12px' }} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'b2b' ? 'B2B' : 'Retail'}</button>
            ))}
          </div>
          <input style={{ width: 240 }} placeholder="Search name, company or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && <button className="btn primary" onClick={openNew}>Add customer</button>}
        </div>
      </div>

      {customers && customers.length === 0 ? (
        <div className="empty">No customers yet. Customers added at the POS appear here too.</div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Company</th><th>Type</th><th>Phone</th><th className="right">Credit limit</th><th className="right">Owes you</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const o = owed?.[p.id] ?? 0;
              const over = Number(p.credit_limit) > 0 && o > Number(p.credit_limit);
              return (
                <tr key={p.id} onClick={() => openEdit(p)}>
                  <td>{p.name}</td><td className="mute">{p.company ?? ''}</td><td>{p.is_business ? 'B2B' : <span className="mute">Retail</span>}</td>
                  <td className="num mute">{p.phone ?? ''}</td>
                  <td className="right num">{Number(p.credit_limit) > 0 ? money(Number(p.credit_limit)) : ''}</td>
                  <td className={'right num ' + (over ? 'warn' : '')} title={over ? 'Over the credit limit' : undefined}>{money(o)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} wide title={form?.id ? 'Customer' : 'New customer'}
        footer={form && (
          <>
            {form.id && canEdit ? <button className="btn danger" onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              {form.id && <Link className="btn" href={`/ledgers/?kind=customer&id=${form.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>Open ledger</Link>}
              <button className="btn quiet" onClick={() => setForm(null)}>Close</button>
              {canEdit && <button className="btn primary" onClick={save}>Save customer</button>}
            </span>
          </>
        )}>
        {form && (
          <>
            <div className="two">
              <label>Name<input value={form.name} autoFocus disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Phone<input inputMode="tel" value={form.phone} disabled={!canEdit} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={form.is_business} disabled={!canEdit} onChange={(e) => setForm({ ...form, is_business: e.target.checked })} />Business (B2B) customer</label>
            <div className="two">
              <label>Company<input value={form.company} disabled={!canEdit} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
              <label>Address<input value={form.address} disabled={!canEdit} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            </div>
            <div className="two">
              <label>Credit limit<input inputMode="decimal" placeholder="No limit" value={form.credit_limit} disabled={!canEdit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></label>
              <label>Opening balance (owed before the POS)<input inputMode="decimal" value={form.opening_balance} disabled={!canEdit} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></label>
            </div>
            {error && !rec && <div className="err">{error}</div>}

            {form.id && (
              <>
                <div className="summary">
                  <div className="rl2"><b>Owes you</b><b className={'num ' + (balance > 0.5 ? 'warn' : '')}>{money(balance)}</b></div>
                  {limit > 0 && <div className={'rl2 ' + (balance > limit ? 'warn' : 'mute')}><span>Credit limit</span><span className="num">{money(limit)}{balance > limit ? ', over the limit' : ''}</span></div>}
                  {canEdit && (!rec ? (
                    <div><button className="btn small" onClick={() => { setError(''); setRec({ amount: balance > 0 ? String(round2(balance)) : '', accountId: '', note: '' }); }}>Receive payment</button></div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label>Amount<input inputMode="decimal" value={rec.amount} autoFocus onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></label>
                      <label>Received into<AccountPicker accounts={accounts} value={rec.accountId} onChange={(id) => setRec({ ...rec, accountId: id })} /></label>
                      <label>Note<input value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} /></label>
                      {error && <div className="err">{error}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn small primary" onClick={saveReceipt}>Save receipt</button>
                        <button className="btn small quiet" onClick={() => { setRec(null); setError(''); }}>Cancel</button>
                      </div>
                    </div>
                  ))}
                </div>
                <h2>Recent activity</h2>
                {!stmt || stmt.rows.length === 0 ? <div className="mute">No activity yet.</div> : (
                  <table className="plain">
                    <tbody>
                      {[...stmt.rows].reverse().slice(0, 10).map((r) => (
                        <tr key={r.id}>
                          <td className="num mute">{shortDate(r.at)}</td><td>{r.label}{r.ref ? ` ${r.ref}` : ''}</td>
                          <td className="right num">{r.plus ? money(r.plus) : `-${money(r.minus)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

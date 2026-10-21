'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money, round2, uid } from '@/lib/util';
import { shortDate } from '@/lib/period';
import { supplierBalances } from '@/lib/ledger';
import type { Party } from '@/lib/types';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';

interface Form { id: string | null; name: string; phone: string; company: string; address: string; opening: string }

export default function SuppliersPage() {
  const { can, legacy } = useProfile();
  const canEdit = can('suppliers.edit');
  const data = useLiveQuery(async () => {
    const [suppliers, purchases, pays, accounts] = await Promise.all([
      db.parties.filter((p) => p.type === 'supplier' && !p.deleted_at).toArray(),
      db.purchases.filter((p) => !p.deleted_at && !!p.party_id).toArray(),
      db.transactions.filter((t) => !t.deleted_at && t.type === 'payment' && !!t.party_id).toArray(),
      db.accounts.toArray(),
    ]);
    return { suppliers, purchases, pays, accounts };
  }, []);
  const owed = useLiveQuery(() => supplierBalances(), []);

  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [pay, setPay] = useState<{ amount: string; accountId: string; note: string } | null>(null);

  const stats = useMemo(() => {
    const m: Record<string, { purchased: number; paid: number }> = {};
    data?.purchases.forEach((p) => {
      const s = (m[p.party_id!] ??= { purchased: 0, paid: 0 });
      s.purchased += Number(p.total); s.paid += Number(p.paid);
    });
    data?.pays.forEach((t) => { const s = (m[t.party_id!] ??= { purchased: 0, paid: 0 }); s.paid += Number(t.amount); });
    return m;
  }, [data]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = (data?.suppliers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.phone ?? '').includes(s)) : all;
  }, [data, q]);
  const totalOwed = round2(list.reduce((s, p) => s + Math.max(owed?.[p.id] ?? 0, 0), 0));

  const ledger = useMemo(() => {
    if (!form?.id || !data) return [];
    const rows = [
      ...data.purchases.filter((p) => p.party_id === form.id).map((p) => ({
        id: p.id, at: p.created_at, label: `Purchase ${p.purchase_no}`, detail: `total ${money(p.total)}, paid ${money(p.paid)}`,
      })),
      ...data.pays.filter((t) => t.party_id === form.id).map((t) => ({
        id: t.id, at: t.created_at, label: 'Payment', detail: money(t.amount),
      })),
    ];
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [form?.id, data]);

  function openNew() { setError(''); setPay(null); setForm({ id: null, name: '', phone: '', company: '', address: '', opening: '' }); }
  function openEdit(p: Party) { setError(''); setPay(null); setForm({ id: p.id, name: p.name, phone: p.phone ?? '', company: p.company ?? '', address: p.address ?? '', opening: p.opening_balance ? String(p.opening_balance) : '' }); }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return setError('Enter the supplier name.');
    const opening = Number(form.opening || 0);
    if (!isFinite(opening) || Math.abs(opening) >= 1e9) return setError('Opening balance must be a reasonable number, or empty.');
    const cur = form.id ? await db.parties.get(form.id) : undefined;
    const id = cur?.id ?? uid();
    await putRow('parties', {
      ...(cur ?? { id, type: 'supplier', created_at: new Date().toISOString(), deleted_at: null }),
      name, phone: form.phone.trim() || null,
      ...(legacy ? {} : { company: form.company.trim() || null, address: form.address.trim() || null, opening_balance: opening }),
    });
    if (!form.id) setForm({ ...form, id, name, phone: form.phone.trim() }); else setForm(null);
  }

  async function remove() {
    if (!form?.id) return;
    if (!window.confirm('Delete this supplier? Their past purchases stay in the records.')) return;
    const cur = await db.parties.get(form.id);
    if (cur) await putRow('parties', { ...cur, deleted_at: new Date().toISOString() });
    setForm(null);
  }

  async function savePayment() {
    if (!form?.id || !pay) return;
    const amount = Number(pay.amount);
    const accountId = pay.accountId || defaultAccountId(data?.accounts);
    if (!isFinite(amount) || amount <= 0) return setError('Enter an amount above zero.');
    if (!accountId) return setError('Accounts are not loaded yet. Press Sync now once while online.');
    await putRow('transactions', {
      id: uid(), account_id: accountId, direction: 'out', amount, type: 'payment', party_id: form.id,
      ref_id: null, note: pay.note.trim() || null, created_at: new Date().toISOString(), deleted_at: null,
    });
    setPay(null); setError('');
  }

  const balance = form?.id ? owed?.[form.id] ?? 0 : 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>Suppliers</h1>
          <div className="mute num">{list.length} {list.length === 1 ? 'supplier' : 'suppliers'}, you owe {money(totalOwed)}</div>
        </div>
        <div className="tools">
          <input style={{ width: 260 }} placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && <button className="btn primary" onClick={openNew}>Add supplier</button>}
        </div>
      </div>

      {data && data.suppliers.length === 0 ? (
        <div className="empty">No suppliers yet. Add one, then record what you buy from them on the Purchases page.</div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th className="right">Purchased</th><th className="right">Paid</th><th className="right">You owe</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const s = stats[p.id] ?? { purchased: 0, paid: 0 };
              const o = owed?.[p.id] ?? 0;
              return (
                <tr key={p.id} onClick={() => openEdit(p)}>
                  <td>{p.name}</td>
                  <td className="num mute">{p.phone ?? ''}</td>
                  <td className="right num">{money(s.purchased)}</td>
                  <td className="right num">{money(s.paid)}</td>
                  <td className={'right num ' + (o > 0.5 ? 'warn' : '')}>{money(o)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} wide title={form?.id ? 'Supplier' : 'New supplier'}
        footer={form && (
          <>
            {form.id && canEdit ? <button className="btn danger" onClick={remove}>Delete</button> : <span />}
            <span style={{ display: 'flex', gap: 8 }}>
              {form.id && can('purchases.edit') && <Link className="btn" href={`/purchases/?supplier=${form.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>New purchase</Link>}
              <button className="btn quiet" onClick={() => setForm(null)}>Close</button>
              {canEdit && <button className="btn primary" onClick={save}>Save supplier</button>}
            </span>
          </>
        )}>
        {form && (
          <>
            <div className="two">
              <label>Name<input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Phone<input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
            {!legacy && (
              <>
                <div className="two">
                  <label>Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
                  <label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
                </div>
                <label>Opening balance (you owed them before the POS)<input inputMode="decimal" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} /></label>
              </>
            )}
            {error && !pay && <div className="err">{error}</div>}

            {form.id && (
              <>
                <div className="summary">
                  <div className="rl2"><b>You owe this supplier</b><b className={'num ' + (balance > 0.5 ? 'warn' : '')}>{money(balance)}</b></div>
                  {!pay ? (
                    <div>{canEdit && <button className="btn small" onClick={() => { setError(''); setPay({ amount: balance > 0 ? String(round2(balance)) : '', accountId: '', note: '' }); }}>Pay supplier</button>}</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label>Amount<input inputMode="decimal" value={pay.amount} autoFocus onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
                      <label>Paid from<AccountPicker accounts={data?.accounts} value={pay.accountId} onChange={(id) => setPay({ ...pay, accountId: id })} /></label>
                      <label>Note<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
                      {error && <div className="err">{error}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn small primary" onClick={savePayment}>Save payment</button>
                        <button className="btn small quiet" onClick={() => { setPay(null); setError(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <h2>History</h2>
                {ledger.length === 0 ? <div className="mute">No purchases or payments yet.</div> : (
                  <table className="plain">
                    <tbody>
                      {ledger.map((r) => (
                        <tr key={r.id}><td className="num mute">{shortDate(r.at)}</td><td>{r.label}</td><td className="right num">{r.detail}</td></tr>
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

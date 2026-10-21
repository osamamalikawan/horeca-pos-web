'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRow } from '@/lib/db';
import { money, round2, uid } from '@/lib/util';
import { customerBalances, supplierBalances } from '@/lib/ledger';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import type { Party } from '@/lib/types';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import PeriodTabs from '@/components/PeriodTabs';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';

interface Form { dir: 'in' | 'out'; party: Party | null; amount: string; accountId: string; note: string }

export default function PaymentsPage() {
  const canEdit = useProfile().can('payments.edit');
  const parties = useLiveQuery(() => db.parties.filter((p) => !p.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const txs = useLiveQuery(() => db.transactions.filter((t) => !t.deleted_at && (t.type === 'receipt' || t.type === 'payment')).toArray(), []);
  const owed = useLiveQuery(() => customerBalances(), []);
  const payable = useLiveQuery(() => supplierBalances(), []);

  const [period, setPeriod] = useState<Period>('month');
  const [form, setForm] = useState<Form | null>(null);
  const [pq, setPq] = useState('');
  const [newParty, setNewParty] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState('');

  const partyById = useMemo(() => new Map((parties ?? []).map((p) => [p.id, p])), [parties]);
  const accName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const rows = useMemo(
    () => (txs ?? []).filter((t) => inPeriod(t.created_at, period)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [txs, period],
  );
  const received = rows.filter((t) => t.direction === 'in').reduce((s, t) => s + Number(t.amount), 0);
  const paidOut = rows.filter((t) => t.direction === 'out').reduce((s, t) => s + Number(t.amount), 0);

  const creditors = useMemo(
    () => (parties ?? []).filter((p) => p.type === 'supplier' && (payable?.[p.id] ?? 0) > 0.5)
      .sort((a, b) => (payable![b.id] ?? 0) - (payable![a.id] ?? 0)),
    [parties, payable],
  );

  const debtors = useMemo(
    () => (parties ?? []).filter((p) => p.type === 'customer' && (owed?.[p.id] ?? 0) > 0.5)
      .sort((a, b) => (owed![b.id] ?? 0) - (owed![a.id] ?? 0)),
    [parties, owed],
  );

  function open(dir: 'in' | 'out', party: Party | null = null) {
    if (!canEdit) return;
    setError(''); setPq(''); setNewParty(null);
    const bal = party ? (dir === 'in' ? owed : payable)?.[party.id] ?? 0 : 0;
    setForm({ dir, party, amount: bal > 0 ? String(round2(bal)) : '', accountId: defaultAccountId(accounts), note: '' });
  }

  const matches = useMemo(() => {
    if (!form) return [];
    const type = form.dir === 'in' ? 'customer' : 'supplier';
    const s = pq.trim().toLowerCase();
    const all = (parties ?? []).filter((p) => p.type === type);
    return (s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.phone ?? '').includes(s)) : all).slice(0, 5);
  }, [parties, pq, form]);

  async function saveParty() {
    if (!form || !newParty || !newParty.name.trim()) return;
    const row = await putRow('parties', {
      id: uid(), name: newParty.name.trim(), phone: newParty.phone.trim() || null,
      type: form.dir === 'in' ? 'customer' : 'supplier', created_at: new Date().toISOString(), deleted_at: null,
    });
    setForm({ ...form, party: row as Party }); setNewParty(null); setPq('');
  }

  async function save() {
    if (!form) return;
    const amount = Number(form.amount);
    const accountId = form.accountId || defaultAccountId(accounts);
    if (!isFinite(amount) || amount <= 0) return setError('Enter an amount above zero.');
    if (!accountId) return setError('Accounts are not loaded yet. Press Sync now once while online.');
    const now = new Date().toISOString();
    await putRow('transactions', {
      id: uid(), account_id: accountId, direction: form.dir, amount,
      type: form.dir === 'in' ? 'receipt' : 'payment', party_id: form.party?.id ?? null, ref_id: null,
      note: form.note.trim() || null, created_at: now, deleted_at: null,
    });
    setForm(null);
  }

  async function voidTx(id: string) {
    if (!window.confirm('Void this payment? It will be removed from the account balance.')) return;
    const t = await db.transactions.get(id);
    if (t) await putRow('transactions', { ...t, deleted_at: new Date().toISOString() });
  }

  const bal = form?.party ? (form.dir === 'in' ? owed : payable)?.[form.party.id] ?? 0 : null;

  return (
    <>
      <div className="head">
        <div>
          <h1>Payments</h1>
          <div className="mute num">Received {money(received)}, paid {money(paidOut)}</div>
        </div>
        <div className="tools">
          <PeriodTabs value={period} onChange={setPeriod} />
          {canEdit && <button className="btn" onClick={() => open('out')}>Pay</button>}
          {canEdit && <button className="btn primary" onClick={() => open('in')}>Receive</button>}
        </div>
      </div>

      {debtors.length > 0 && (
        <>
          <h2 style={{ marginBottom: 8 }}>Customers who owe</h2>
          <div className="cards">
            {debtors.slice(0, 8).map((p) => (
              <button key={p.id} className="card" onClick={() => open('in', p)}>
                <span>{p.name}</span>
                <span className="big num">{money(owed![p.id])}</span>
                <span className="sub">{p.phone ?? 'No phone'}. Choose to receive payment.</span>
              </button>
            ))}
          </div>
        </>
      )}

      {creditors.length > 0 && (
        <>
          <h2 style={{ marginBottom: 8 }}>Suppliers you owe</h2>
          <div className="cards">
            {creditors.slice(0, 8).map((p) => (
              <button key={p.id} className="card" onClick={() => open('out', p)}>
                <span>{p.name}</span>
                <span className="big num">{money(payable![p.id])}</span>
                <span className="sub">{p.phone ?? 'No phone'}. Choose to pay.</span>
              </button>
            ))}
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="empty">No payments in this period.</div>
      ) : (
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Party</th><th>Account</th><th>Note</th><th className="right">Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={{ cursor: 'default' }}>
                <td className="num mute">{shortDate(t.created_at)}</td>
                <td>{t.direction === 'in' ? 'Received' : 'Paid'}</td>
                <td>{t.party_id ? partyById.get(t.party_id)?.name ?? '' : ''}</td>
                <td>{accName.get(t.account_id) ?? ''}</td>
                <td className="mute">{t.note ?? ''}</td>
                <td className="right num">{t.direction === 'in' ? '' : '-'}{money(t.amount)}</td>
                <td className="right">{canEdit && <button className="btn small quiet" onClick={() => voidTx(t.id)}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} title={form?.dir === 'in' ? 'Receive payment' : 'Pay payment'}
        footer={form && (<><span /><span style={{ display: 'flex', gap: 8 }}>
          <button className="btn quiet" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn primary" onClick={save}>{form.dir === 'in' ? 'Save receipt' : 'Save payment'}</button>
        </span></>)}>
        {form && (
          <>
            <div style={{ display: 'grid', gap: 6 }}>
              <span className="mute" style={{ fontSize: 13 }}>{form.dir === 'in' ? 'Customer (optional)' : 'Supplier (optional)'}</span>
              {form.party ? (
                <div className="chip">
                  <span>{form.party.name}{form.party.phone ? `, ${form.party.phone}` : ''}</span>
                  <button className="x" onClick={() => setForm({ ...form, party: null })} aria-label="Remove">×</button>
                </div>
              ) : newParty ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input placeholder="Name" value={newParty.name} autoFocus onChange={(e) => setNewParty({ ...newParty, name: e.target.value })} />
                  <input placeholder="Phone" inputMode="tel" value={newParty.phone} onChange={(e) => setNewParty({ ...newParty, phone: e.target.value })} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small primary" onClick={saveParty} disabled={!newParty.name.trim()}>Save</button>
                    <button className="btn small quiet" onClick={() => setNewParty(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder="Search by name or phone" value={pq} onChange={(e) => setPq(e.target.value)} />
                    <button className="btn small" style={{ height: 38 }} onClick={() => setNewParty({ name: /\d/.test(pq) ? '' : pq, phone: /\d/.test(pq) ? pq : '' })}>New</button>
                  </div>
                  {matches.length > 0 && (
                    <div className="pick">
                      {matches.map((p) => (
                        <button key={p.id} onClick={() => open(form.dir, p)}>
                          <span>{p.name}</span><span className="mute">{p.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {bal !== null && <div className={'num ' + (bal > 0 ? 'warn' : 'mute')}>{bal > 0 ? (form?.dir === 'in' ? `Owes ${money(bal)}` : `You owe ${money(bal)}`) : 'Nothing owed'}</div>}
            </div>
            <label>Amount<input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>{form.dir === 'in' ? 'Received into' : 'Paid from'}
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

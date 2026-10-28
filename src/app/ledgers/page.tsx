'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { downloadCsv, money, round2 } from '@/lib/util';
import { customerBalances, employeeBalances, supplierBalances } from '@/lib/ledger';
import { loadStatement, type PartyKind } from '@/lib/statements';
import { printPage } from '@/lib/print';
import Drawer from '@/components/Drawer';
import PrintPortal from '@/components/PrintPortal';
import StatementView from '@/components/StatementView';
import { useSettings } from '@/components/SettingsProvider';

const TABS: { kind: PartyKind; label: string }[] = [
  { kind: 'customer', label: 'Customers' }, { kind: 'supplier', label: 'Suppliers' }, { kind: 'employee', label: 'Employees' },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function LedgersPage() {
  const { settings } = useSettings();
  const [kind, setKind] = useState<PartyKind>('customer');
  const [q, setQ] = useState('');
  const [b2b, setB2b] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const parties = useLiveQuery(() => db.parties.filter((p) => !p.deleted_at).toArray(), []);
  const employees = useLiveQuery(() => db.employees.filter((e) => !e.deleted_at).toArray(), []);
  const bal = useLiveQuery(async () => ({ customer: await customerBalances(), supplier: await supplierBalances(), employee: await employeeBalances() }), []);
  const statement = useLiveQuery(() => (openId ? loadStatement(kind, openId, from || null, to || null) : undefined), [kind, openId, from, to]);

  // opened from another page: /ledgers/?kind=customer&id=...
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const k = sp.get('kind') as PartyKind | null, id = sp.get('id');
    if (k && id && ['customer', 'supplier', 'employee'].includes(k)) { setKind(k); setOpenId(id); }
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = kind === 'employee'
      ? (employees ?? []).map((e) => ({ id: e.id, name: e.name, sub: e.designation ?? '', phone: e.phone }))
      : (parties ?? []).filter((p) => p.type === kind && (kind !== 'customer' || !b2b || p.is_business))
          .map((p) => ({ id: p.id, name: p.name, sub: p.company ?? '', phone: p.phone }));
    const b = bal?.[kind] ?? {};
    return rows.filter((r) => !s || r.name.toLowerCase().includes(s) || (r.phone ?? '').includes(s) || r.sub.toLowerCase().includes(s))
      .map((r) => ({ ...r, balance: round2(b[r.id] ?? 0) }))
      .sort((a, b2) => Math.abs(b2.balance) - Math.abs(a.balance) || a.name.localeCompare(b2.name));
  }, [kind, q, b2b, parties, employees, bal]);
  const outstanding = round2(list.reduce((s, r) => s + Math.max(r.balance, 0), 0));
  const balHead = kind === 'customer' ? 'Owes you' : 'You owe';

  function range(which: 'all' | 'month' | 'last') {
    const now = new Date();
    if (which === 'all') { setFrom(''); setTo(''); }
    if (which === 'month') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(''); }
    if (which === 'last') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(ymd(new Date(now.getFullYear(), now.getMonth(), 0))); }
  }
  function exportCsv() {
    if (!statement) return;
    const s = statement;
    downloadCsv(`ledger-${s.name.replace(/\s+/g, '-')}.csv`, [
      ['Date', 'Type', 'Reference', 'Note', s.plusLabel, s.minusLabel, 'Balance'],
      ['', 'Opening balance', '', '', '', '', s.opening],
      ...s.rows.map((r) => [new Date(r.at).toLocaleDateString(), r.label, r.ref, r.note, r.plus || '', r.minus || '', r.balance]),
      ['', 'Closing balance', '', '', s.totalPlus, s.totalMinus, s.closing],
    ]);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Ledgers</h1>
          <div className="mute num">{list.length} accounts, outstanding {money(outstanding)}</div>
        </div>
        <div className="tools">
          <input style={{ width: 240 }} placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)', width: 360 }} role="tablist">
          {TABS.map((t) => <button key={t.kind} className={kind === t.kind ? 'on' : ''} onClick={() => setKind(t.kind)}>{t.label}</button>)}
        </div>
        {kind === 'customer' && (
          <label className="check"><input type="checkbox" checked={b2b} onChange={(e) => setB2b(e.target.checked)} />Business (B2B) customers only</label>
        )}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          {kind === 'customer' && b2b ? 'No business customers yet. Mark a customer as B2B on the Customers page, or untick the box to see all customers.' : 'Nothing here yet.'}
        </div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>{kind === 'employee' ? 'Designation' : 'Company'}</th><th>Phone</th><th className="right">{balHead}</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} onClick={() => { setOpenId(r.id); range('all'); }}>
                <td>{r.name}</td><td className="mute">{r.sub}</td><td className="num mute">{r.phone ?? ''}</td>
                <td className={'right num ' + (r.balance > 0.5 ? 'warn' : '')}>{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)} wide title={statement ? `Ledger, ${statement.name}` : 'Ledger'}
        footer={(
          <>
            <button className="btn quiet" onClick={() => setOpenId(null)}>Close</button>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={!statement} onClick={exportCsv}>Export CSV</button>
              <button className="btn primary" disabled={!statement} onClick={() => printPage('@page{size:A4;margin:12mm}', 'document')}>Print statement</button>
            </span>
          </>
        )}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn small quiet" onClick={() => range('all')}>All dates</button>
          <button className="btn small quiet" onClick={() => range('month')}>This month</button>
          <button className="btn small quiet" onClick={() => range('last')}>Last month</button>
        </div>
        {statement && <StatementView s={statement} from={from} to={to} />}
      </Drawer>
      {statement && <PrintPortal><StatementView s={statement} from={from} to={to} store={settings.store.name} /></PrintPortal>}
    </>
  );
}

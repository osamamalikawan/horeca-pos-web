'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { money, qtyFmt, round2 } from '@/lib/util';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import { createPurchaseReturn, loadPurchase, maxCashRefund, unitCostPaid } from '@/lib/purchaseReturns';
import Drawer from '@/components/Drawer';
import PeriodTabs from '@/components/PeriodTabs';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';
import { useProfile } from '@/components/ProfileProvider';

export default function PurchaseReturnsPage() {
  const canEdit = useProfile().can('purchases.edit');
  const data = useLiveQuery(async () => {
    const [purchases, parties, rets, accounts] = await Promise.all([
      db.purchases.filter((p) => !p.deleted_at).toArray(),
      db.parties.toArray(),
      db.purchase_returns.filter((r) => !r.deleted_at).toArray(),
      db.accounts.toArray(),
    ]);
    return { purchases, parties, rets, accounts };
  }, []);

  const [period, setPeriod] = useState<Period>('month');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [purchaseId, setPurchaseId] = useState<string | null>(null);   // new return
  const [viewId, setViewId] = useState<string | null>(null);           // existing return
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'cash' | 'credit'>('cash');
  const [cashStr, setCashStr] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const bundle = useLiveQuery(() => (purchaseId ? loadPurchase(purchaseId) : undefined), [purchaseId]);
  const viewed = useLiveQuery(async () => {
    if (!viewId) return undefined;
    const r = await db.purchase_returns.get(viewId);
    if (!r) return undefined;
    const items = await db.purchase_return_items.where('return_id').equals(viewId).toArray();
    const b = await loadPurchase(r.purchase_id);
    return { r, items, b };
  }, [viewId]);

  function startReturn(id: string) {
    if (!canEdit) return;
    setPurchaseId(id); setQtys({}); setNote(''); setErr(''); setAccountId(''); setMode('cash'); setCashStr(''); setQ('');
  }
  // opened from the Purchases page: /purchase-returns/?purchase=...
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('purchase');
    if (id) startReturn(id);
  }, [canEdit]);   // eslint-disable-line react-hooks/exhaustive-deps

  const party = useMemo(() => new Map((data?.parties ?? []).map((p) => [p.id, p])), [data]);
  const purchaseNo = useMemo(() => new Map((data?.purchases ?? []).map((p) => [p.id, p.purchase_no])), [data]);
  const accName = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a.name])), [data]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return [];
    return data.purchases.filter((p) => {
      if (p.cancelled_at) return false;
      const sup = p.party_id ? party.get(p.party_id) : null;
      return p.purchase_no.toLowerCase().includes(s) || (p.bill_no ?? '').toLowerCase().includes(s)
        || (sup?.name.toLowerCase().includes(s) ?? false) || (sup?.phone ?? '').includes(s);
    }).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  }, [q, data, party]);

  const rows = useMemo(
    () => (data?.rets ?? []).filter((r) => inPeriod(r.created_at, period)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data, period],
  );
  const rowsTotal = round2(rows.reduce((s, r) => s + Number(r.total), 0));

  const calc = useMemo(() => {
    if (!bundle) return null;
    const lines = bundle.items.map((it) => {
      const left = Math.max(Number(it.qty) - (bundle.returnedQty[it.id] ?? 0), 0);
      const want = Math.min(Math.max(Number(qtys[it.id]) || 0, 0), left);
      return { it, left, want, refund: round2(unitCostPaid(it) * want) };
    });
    const picked = lines.filter((l) => l.want > 0);
    const value = round2(picked.reduce((s, l) => s + l.refund, 0));
    const maxCash = maxCashRefund(bundle, value);
    const typed = cashStr.trim() === '' ? maxCash : Math.max(Number(cashStr) || 0, 0);
    const cash = mode === 'credit' ? 0 : round2(Math.min(typed, maxCash));
    return { lines, picked, value, units: picked.reduce((s, l) => s + l.want, 0), maxCash, cash, credit: round2(value - cash) };
  }, [bundle, qtys, mode, cashStr]);

  const acc = accountId || defaultAccountId(data?.accounts);

  async function save() {
    if (!bundle || !calc) return;
    setBusy(true); setErr('');
    try {
      await createPurchaseReturn({
        purchaseId: bundle.purchase.id, cash: calc.cash, accountId: acc || null, note,
        lines: calc.picked.map((l) => ({ itemId: l.it.id, qty: l.want })),
      });
      setPurchaseId(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  const mark: Record<string, number> = {};
  viewed?.items.forEach((i) => { mark[i.purchase_item_id] = (mark[i.purchase_item_id] ?? 0) + Number(i.qty); });

  return (
    <>
      <div className="head">
        <div>
          <h1>Purchase returns</h1>
          <div className="mute num">{rows.length} {rows.length === 1 ? 'return' : 'returns'}, {money(rowsTotal)}. Items sent back to a supplier.</div>
        </div>
        <div className="tools"><PeriodTabs value={period} onChange={setPeriod} /></div>
      </div>

      {canEdit && (
        <div style={{ maxWidth: 560, marginBottom: 20, display: 'grid', gap: 6 }}>
          <input placeholder="Find the purchase to send items back from: number, supplier or bill number" value={q}
            onChange={(e) => { setQ(e.target.value); setMsg(''); }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const exact = matches.find((m) => m.purchase_no.toLowerCase() === q.trim().toLowerCase());
              const hit = exact ?? (matches.length === 1 ? matches[0] : undefined);
              if (hit) startReturn(hit.id); else setMsg(matches.length ? 'Choose a purchase from the list.' : 'No purchase found.');
            }} />
          {msg && <div className="err">{msg}</div>}
          {matches.length > 0 && (
            <div className="pick">
              {matches.map((p) => {
                const sup = p.party_id ? party.get(p.party_id) : null;
                return (
                  <button key={p.id} onClick={() => startReturn(p.id)}>
                    <span className="num">{p.purchase_no} <span className="mute">{shortDate(p.created_at)}{p.bill_no ? `, bill ${p.bill_no}` : ''}</span></span>
                    <span>{sup?.name ?? 'No supplier'}, <span className="num">{money(p.total)}</span></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">No purchase returns in this period.</div>
      ) : (
        <table>
          <thead><tr><th>Return</th><th>Date</th><th>Purchase</th><th>Supplier</th><th className="right">Value</th><th className="right">Paid back</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setViewId(r.id)}>
                <td className="num">{r.return_no}</td>
                <td className="num mute">{shortDate(r.created_at)}</td>
                <td className="num">{purchaseNo.get(r.purchase_id) ?? ''}</td>
                <td>{r.party_id ? party.get(r.party_id)?.name ?? '' : <span className="mute">No supplier</span>}</td>
                <td className="right num">{money(r.total)}</td>
                <td className="right num">{Number(r.cash_refund) > 0 ? money(r.cash_refund) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* new return */}
      <Drawer open={!!purchaseId} onClose={() => setPurchaseId(null)} wide
        title={bundle ? `Send back from ${bundle.purchase.purchase_no}` : 'Purchase return'}
        footer={calc && (
          <>
            <span className="mute num">{calc.picked.length} {calc.picked.length === 1 ? 'product' : 'products'}, {qtyFmt(calc.units)} {calc.units === 1 ? 'unit' : 'units'}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setPurchaseId(null)}>Cancel</button>
              <button className="btn primary" disabled={!calc.picked.length || busy} onClick={save}>{busy ? 'Saving…' : `Complete return, ${money(calc.value)}`}</button>
            </span>
          </>
        )}>
        {bundle && calc && (
          <>
            <dl className="kv" style={{ textAlign: 'left' }}>
              <dt>Supplier</dt><dd>{bundle.supplier ? `${bundle.supplier.name}${bundle.supplier.phone ? `, ${bundle.supplier.phone}` : ''}` : 'No supplier'}</dd>
              <dt>Purchase date</dt><dd className="num">{new Date(bundle.purchase.created_at).toLocaleString()}</dd>
              <dt>Purchase total</dt><dd className="num">{money(bundle.purchase.total)}, paid {money(bundle.purchase.paid)}</dd>
            </dl>
            <table className="plain">
              <thead><tr><th>Item</th><th className="right">Bought</th><th className="right">Sent back</th><th className="right">Send back</th><th className="right">Value</th></tr></thead>
              <tbody>
                {calc.lines.map(({ it, left, want, refund }) => (
                  <tr key={it.id} className={want > 0 ? 'hl' : ''}>
                    <td>{it.name}<div className="mute num" style={{ fontSize: 12 }}>{money(it.unit_cost)} each</div></td>
                    <td className="right num">{qtyFmt(Number(it.qty))}</td>
                    <td className="right num">{qtyFmt(bundle.returnedQty[it.id] ?? 0)}</td>
                    <td className="right">
                      {left > 0 ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input className="num" style={{ width: 64, height: 30, textAlign: 'right' }} inputMode="decimal" aria-label={`Quantity to send back for ${it.name}`}
                            value={qtys[it.id] ?? ''} placeholder="0"
                            onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setQtys({ ...qtys, [it.id]: e.target.value }); }} />
                          <button className="btn small quiet" onClick={() => setQtys({ ...qtys, [it.id]: String(left) })}>All</button>
                        </span>
                      ) : <span className="mute">All sent back</span>}
                    </td>
                    <td className="right num">{want > 0 ? <b>{money(refund)}</b> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={calc.picked.length ? 'summary hl' : 'summary'}>
              <h2>Return details</h2>
              {calc.picked.length === 0 ? <div className="mute">Enter a quantity next to the items you are sending back.</div> : (
                <>
                  {calc.picked.map((l) => (
                    <div className="rl2" key={l.it.id}><span>{l.it.name} × {qtyFmt(l.want)}</span><span className="num">{money(l.refund)}</span></div>
                  ))}
                  <div className="rl2"><b>Value of items sent back</b><b className="num">{money(calc.value)}</b></div>
                  {calc.maxCash > 0 && (
                    <div className="seg" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 4 }} role="group" aria-label="How the supplier settles">
                      <button className={mode === 'cash' ? 'on' : ''} onClick={() => setMode('cash')}>Supplier pays back</button>
                      <button className={mode === 'credit' ? 'on' : ''} onClick={() => setMode('credit')}>Keep as credit</button>
                    </div>
                  )}
                  {calc.maxCash > 0 && mode === 'cash' && (
                    <label>Money paid back now (up to {money(calc.maxCash)})
                      <input inputMode="decimal" className="num" placeholder={String(calc.maxCash)} value={cashStr}
                        onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setCashStr(e.target.value); }} />
                    </label>
                  )}
                  {calc.cash > 0 && <div className="rl2"><span>Money paid back</span><span className="num">{money(calc.cash)}</span></div>}
                  {calc.credit > 0 && <div className="rl2"><span>Taken off what you owe the supplier{calc.maxCash === 0 ? '' : ' (credit)'}</span><span className="num">{money(calc.credit)}</span></div>}
                  {calc.maxCash === 0 && Number(bundle.purchase.paid) < Number(bundle.purchase.total) - 0.005 && (
                    <div className="mute" style={{ fontSize: 13 }}>This purchase is not fully paid, so the value lowers what you still owe.</div>
                  )}
                </>
              )}
            </div>
            {calc.cash > 0 && (
              <label>Money paid into
                <AccountPicker accounts={data?.accounts} value={accountId} onChange={setAccountId} />
              </label>
            )}
            <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" /></label>
            {err && <div className="err">{err}</div>}
          </>
        )}
      </Drawer>

      {/* existing return */}
      <Drawer open={!!viewId} onClose={() => setViewId(null)} wide title={viewed ? `Purchase return ${viewed.r.return_no}` : 'Purchase return'}>
        {viewed && viewed.b && (
          <>
            <dl className="kv" style={{ textAlign: 'left' }}>
              <dt>Date</dt><dd className="num">{new Date(viewed.r.created_at).toLocaleString()}</dd>
              <dt>Purchase</dt><dd className="num">{viewed.b.purchase.purchase_no}{viewed.b.supplier ? `, ${viewed.b.supplier.name}` : ''}</dd>
              <dt>Value of items sent back</dt><dd className="num"><b>{money(viewed.r.total)}</b></dd>
              <dt>Money paid back</dt><dd className="num">{Number(viewed.r.cash_refund) > 0 ? `${money(viewed.r.cash_refund)}${viewed.r.account_id ? ` into ${accName.get(viewed.r.account_id) ?? ''}` : ''}` : 'None'}</dd>
              <dt>Taken off what you owe</dt><dd className="num">{Number(viewed.r.credit_adjust) > 0 ? money(viewed.r.credit_adjust) : 'None'}</dd>
              {viewed.r.note && (<><dt>Note</dt><dd>{viewed.r.note}</dd></>)}
            </dl>
            <h2>Purchase, items sent back highlighted</h2>
            <table className="plain">
              <thead><tr><th>Item</th><th className="right">Bought</th><th className="right">Cost price</th><th className="right">Total</th></tr></thead>
              <tbody>
                {viewed.b.items.map((it) => (
                  <tr key={it.id} className={(mark[it.id] ?? 0) > 0 ? 'hl' : ''}>
                    <td>{it.name}{(mark[it.id] ?? 0) > 0 && <div className="tag">Sent back in this return {qtyFmt(mark[it.id])}</div>}</td>
                    <td className="right num">{qtyFmt(Number(it.qty))}</td>
                    <td className="right num">{money(it.unit_cost)}</td>
                    <td className="right num">{money(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Drawer>
    </>
  );
}

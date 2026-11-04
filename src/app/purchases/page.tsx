'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveStock, putRow } from '@/lib/db';
import { money, nextNo, qtyFmt, round2, uid } from '@/lib/util';
import { cancelPurchase } from '@/lib/purchaseReturns';
import { fieldLevel } from '@/lib/permissions';
import { beep } from '@/lib/print';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import type { Party, Product } from '@/lib/types';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import Link from 'next/link';
import PeriodTabs from '@/components/PeriodTabs';
import NumInput from '@/components/NumInput';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';
import { useSettings } from '@/components/SettingsProvider';

interface PLine { product_id: string; name: string; qty: number; cost: number }

export default function PurchasesPage() {
  const { settings } = useSettings();
  const { can } = useProfile();
  const canEdit = can('purchases.edit'), canCancel = can('purchases.cancel');
  const costLevel = fieldLevel(can, 'cost'), seeCost = costLevel !== 'hide', seeStock = fieldLevel(can, 'stock') !== 'hide';
  const data = useLiveQuery(async () => {
    const [purchases, parties, products, accounts] = await Promise.all([
      db.purchases.filter((p) => !p.deleted_at).toArray(),
      db.parties.filter((p) => !p.deleted_at).toArray(),
      db.products.filter((p) => !p.deleted_at).toArray(),
      db.accounts.toArray(),
    ]);
    return { purchases, parties, products, accounts };
  }, []);

  const [period, setPeriod] = useState<Period>('month');
  const [viewId, setViewId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelErr, setCancelErr] = useState('');
  const viewed = useLiveQuery(async () => {
    if (!viewId) return undefined;
    const p = await db.purchases.get(viewId);
    if (!p) return undefined;
    const items = await db.purchase_items.where('purchase_id').equals(viewId).toArray();
    items.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return { p, items };
  }, [viewId]);

  // ---- new purchase form
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [sq, setSq] = useState('');
  const [newSup, setNewSup] = useState<{ name: string; phone: string } | null>(null);
  const [billNo, setBillNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<PLine[]>([]);
  const [pq, setPq] = useState('');
  const [msg, setMsg] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paidRaw, setPaidRaw] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const supplier = (data?.parties ?? []).find((p) => p.id === supplierId) ?? null;
  const supName = useMemo(() => new Map((data?.parties ?? []).map((p) => [p.id, p.name])), [data]);
  const byId = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);

  function openNew(presetSupplier: string | null = null) {
    setSupplierId(presetSupplier); setSq(''); setNewSup(null); setBillNo(''); setNote(''); setLines([]);
    setPq(''); setMsg(''); setAccountId(''); setPaidRaw(''); setUpdateCost(true); setErr(''); setOpen(true);
  }
  // opened from the Suppliers page: /purchases/?supplier=...
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('supplier');
    if (id && canEdit) openNew(id);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(
    () => (data?.purchases ?? []).filter((p) => inPeriod(p.created_at, period)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data, period],
  );
  const rowsTotal = round2(rows.reduce((s, p) => s + (p.cancelled_at ? 0 : Number(p.total)), 0));
  const openView = (id: string) => { setViewId(id); setCancelling(false); setCancelReason(''); setCancelErr(''); };
  async function doCancel() {
    if (!viewId) return;
    try { await cancelPurchase(viewId, cancelReason); setCancelling(false); setCancelErr(''); }
    catch (e: any) { setCancelErr(e?.message ?? String(e)); }
  }

  const productMatches = useMemo(() => {
    const s = pq.trim().toLowerCase();
    if (!s) return [];
    return (data?.products ?? []).filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? '').includes(s) || (p.short_code ?? '').toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [data, pq]);
  const supMatches = useMemo(() => {
    const s = sq.trim().toLowerCase();
    const all = (data?.parties ?? []).filter((p) => p.type === 'supplier');
    return (s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.phone ?? '').includes(s)) : all).slice(0, 5);
  }, [data, sq]);

  function addProduct(p: Product) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: Math.round((l.qty + 1) * 1000) / 1000 } : l));
      return [...ls, { product_id: p.id, name: p.name, qty: 1, cost: seeCost ? Number(p.cost_price) : 0 }];   // a hidden cost price is not pre-filled
    });
    setPq(''); setMsg(''); searchRef.current?.focus();
  }
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const s = pq.trim();
    if (!s) return;
    const exact = (data?.products ?? []).find((p) => p.barcode === s) ?? (data?.products ?? []).find((p) => !!p.short_code && p.short_code.toLowerCase() === s.toLowerCase());
    const hit = exact ?? (productMatches.length === 1 ? productMatches[0] : undefined);
    if (hit) { addProduct(hit); if (exact && settings.scanner.beep) beep(true); }
    else { setMsg('No product matches. Add it on the Products page first.'); if (settings.scanner.beep) beep(false); }
  }
  const patch = (i: number, p: Partial<PLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const total = round2(lines.reduce((s, l) => s + round2(l.qty * l.cost), 0));
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const paid = Math.min(paidRaw === '' ? total : Math.max(Number(paidRaw) || 0, 0), total);
  const due = round2(total - paid);

  async function saveSupplier() {
    if (!newSup || !newSup.name.trim()) return;
    const id = uid();
    await putRow('parties', {
      id, name: newSup.name.trim(), phone: newSup.phone.trim() || null, type: 'supplier',
      created_at: new Date().toISOString(), deleted_at: null,
    });
    setSupplierId(id); setNewSup(null); setSq('');
  }

  async function save() {
    if (!lines.length) return setErr('Add at least one product.');
    if (due > 0 && !supplierId) return setErr('Choose a supplier to leave a balance unpaid.');
    const accId = accountId || defaultAccountId(data?.accounts);
    if (paid > 0 && !accId) return setErr('Accounts are not loaded yet. Press Sync now once while online.');
    setBusy(true); setErr('');
    try {
      await db.transaction('rw', db.tables, async () => {
        const id = uid();
        const no = await nextNo('purchaseSeq', 'P-');
        const now = new Date().toISOString();
        await putRow('purchases', {
          id, purchase_no: no, party_id: supplierId, bill_no: billNo.trim() || null, subtotal: total, total, paid,
          account_id: paid > 0 ? accId : null, note: note.trim() || null, created_at: now, deleted_at: null,
        });
        for (const l of lines) {
          await putRow('purchase_items', {
            id: uid(), purchase_id: id, product_id: l.product_id, name: l.name, qty: l.qty, unit_cost: l.cost,
            line_total: round2(l.qty * l.cost),
          });
          await moveStock(l.product_id, l.qty, 'purchase', id);
          if (updateCost && costLevel === 'edit') {
            const cur = await db.products.get(l.product_id);
            if (cur && Number(cur.cost_price) !== l.cost) await putRow('products', { ...cur, cost_price: l.cost });
          }
        }
        if (paid > 0) {
          await putRow('transactions', {
            id: uid(), account_id: accId, direction: 'out', amount: paid, type: 'purchase',
            party_id: supplierId, ref_id: id, note: no, created_at: now, deleted_at: null,
          });
        }
      });
      setOpen(false);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Purchases</h1>
          <div className="mute num">{rows.length} {rows.length === 1 ? 'purchase' : 'purchases'}, {money(rowsTotal)}. Restock your products here.</div>
        </div>
        <div className="tools">
          <PeriodTabs value={period} onChange={setPeriod} />
          {canEdit && <button className="btn primary" onClick={() => openNew()}>New purchase</button>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No purchases in this period. Choose New purchase to add stock.</div>
      ) : (
        <table>
          <thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th>Bill no</th><th className="right">Total</th><th className="right">Paid</th><th className="right">Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const gone = !!p.cancelled_at;
              const d = gone ? 0 : round2(Number(p.total) - Number(p.paid));
              return (
                <tr key={p.id} onClick={() => openView(p.id)} style={gone ? { color: 'var(--mute)' } : undefined}>
                  <td className="num">{p.purchase_no}</td>
                  <td className="num mute">{shortDate(p.created_at)}</td>
                  <td>{p.party_id ? supName.get(p.party_id) ?? '' : <span className="mute">No supplier</span>}</td>
                  <td className="mute">{p.bill_no ?? ''}</td>
                  <td className="right num" style={gone ? { textDecoration: 'line-through' } : undefined}>{money(p.total)}</td>
                  <td className="right num">{gone ? '' : money(p.paid)}</td>
                  <td className={'right num ' + (d > 0 ? 'warn' : '')}>{d > 0 ? money(d) : ''}</td>
                  <td className={gone ? 'warn' : 'mute'}>{gone ? 'Cancelled' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* new purchase */}
      <Drawer open={open} onClose={() => setOpen(false)} wide title="New purchase"
        footer={(
          <>
            <span className="mute num">{lines.length} {lines.length === 1 ? 'product' : 'products'}, {qtyFmt(units)} {units === 1 ? 'unit' : 'units'}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !lines.length} onClick={save}>{busy ? 'Saving…' : `Save purchase, ${money(total)}`}</button>
            </span>
          </>
        )}>
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="mute" style={{ fontSize: 13 }}>Supplier</span>
          {supplier ? (
            <div className="chip"><span>{supplier.name}{supplier.phone ? `, ${supplier.phone}` : ''}</span>
              <button className="x" onClick={() => setSupplierId(null)} aria-label="Remove supplier">×</button></div>
          ) : newSup ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <input placeholder="Supplier name" value={newSup.name} autoFocus onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} />
              <input placeholder="Phone" inputMode="tel" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn small primary" onClick={saveSupplier} disabled={!newSup.name.trim()}>Save supplier</button>
                <button className="btn small quiet" onClick={() => setNewSup(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <input placeholder="Search supplier by name or phone (optional)" value={sq} onChange={(e) => setSq(e.target.value)} />
                <button className="btn small" style={{ height: 38 }} onClick={() => setNewSup({ name: /\d/.test(sq) ? '' : sq, phone: /\d/.test(sq) ? sq : '' })}>New</button>
              </div>
              {supMatches.length > 0 && (
                <div className="pick">
                  {supMatches.map((p: Party) => (
                    <button key={p.id} onClick={() => { setSupplierId(p.id); setSq(''); }}><span>{p.name}</span><span className="mute">{p.phone}</span></button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="two">
          <label>Supplier bill number<input value={billNo} onChange={(e) => setBillNo(e.target.value)} /></label>
          <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <input ref={searchRef} value={pq} placeholder="Scan a barcode, type a short code or search products to add" onChange={(e) => { setPq(e.target.value); setMsg(''); }} onKeyDown={onSearchKey} />
          {msg && <div className="err">{msg}</div>}
          {productMatches.length > 0 && (
            <div className="pick">
              {productMatches.map((p) => (
                <button key={p.id} onClick={() => addProduct(p)}>
                  <span>{p.name}</span><span className="mute num">{[seeStock ? `stock ${qtyFmt(p.stock_qty)}` : '', seeCost ? `cost ${money(p.cost_price)}` : ''].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length === 0 ? <div className="empty">Search or scan the products you are restocking.</div> : (
          <table className="plain">
            <thead><tr><th>Product</th>{seeStock && <th className="right">In stock</th>}<th className="right">Qty</th><th className="right">Cost price</th><th className="right">Total</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product_id}>
                  <td>{l.name}</td>
                  {seeStock && <td className="right num mute">{qtyFmt(byId.get(l.product_id)?.stock_qty ?? 0)}</td>}
                  <td className="right"><NumInput className="num" label="Quantity" live decimals={3} value={l.qty} onCommit={(n) => patch(i, { qty: n })} /></td>
                  <td className="right"><NumInput className="num" label="Cost price" clearOnFocus value={l.cost} onCommit={(n) => patch(i, { cost: n })} /></td>
                  <td className="right num">{money(l.qty * l.cost)}</td>
                  <td className="right"><button className="x" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {costLevel === 'edit' && <label className="check"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />Update each product’s cost price to the price on this purchase</label>}

        <div className="summary">
          <div className="rl2"><span className="mute">Total products</span><span className="num">{lines.length}</span></div>
          <div className="rl2"><span className="mute">Total quantity</span><span className="num">{qtyFmt(units)}</span></div>
          <div className="rl2"><b>Total</b><b className="num">{money(total)}</b></div>
          <label>Paid from<AccountPicker accounts={data?.accounts} value={accountId} onChange={setAccountId} /></label>
          <label>Amount paid now<input inputMode="decimal" className="num" placeholder={String(total)} value={paidRaw} onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setPaidRaw(e.target.value); }} /></label>
          {due > 0 && <div className="rl2"><span className="mute">Balance you owe the supplier</span><span className="num warn">{money(due)}</span></div>}
        </div>
        {err && <div className="err">{err}</div>}
      </Drawer>

      {/* existing purchase */}
      <Drawer open={!!viewId} onClose={() => setViewId(null)} wide title={viewed ? `Purchase ${viewed.p.purchase_no}` : 'Purchase'}
        footer={viewed && !viewed.p.cancelled_at && (canEdit || canCancel) ? (
          <>
            {canCancel && !cancelling ? <button className="btn danger" onClick={() => { setCancelling(true); setCancelErr(''); }}>Cancel purchase</button> : <span />}
            {canEdit && <Link className="btn" href={`/purchase-returns/?purchase=${viewed.p.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>Send items back</Link>}
          </>
        ) : undefined}>
        {viewed && (
          <>
            <dl className="kv" style={{ textAlign: 'left' }}>
              <dt>Date</dt><dd className="num">{new Date(viewed.p.created_at).toLocaleString()}</dd>
              <dt>Supplier</dt><dd>{viewed.p.party_id ? supName.get(viewed.p.party_id) ?? '' : 'None'}</dd>
              {viewed.p.cancelled_at && (<><dt>Status</dt><dd className="warn">Cancelled{viewed.p.cancel_reason ? `, ${viewed.p.cancel_reason}` : ''}</dd></>)}
              {viewed.p.bill_no && (<><dt>Supplier bill</dt><dd>{viewed.p.bill_no}</dd></>)}
              {viewed.p.note && (<><dt>Note</dt><dd>{viewed.p.note}</dd></>)}
            </dl>
            <table className="plain">
              <thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Cost price</th><th className="right">Total</th></tr></thead>
              <tbody>
                {viewed.items.map((i) => (
                  <tr key={i.id}><td>{i.name}</td><td className="right num">{qtyFmt(Number(i.qty))}</td><td className="right num">{money(i.unit_cost)}</td><td className="right num">{money(i.line_total)}</td></tr>
                ))}
              </tbody>
            </table>
            <dl className="kv">
              <dt>Total products</dt><dd className="num">{viewed.items.length}</dd>
              <dt><b>Total</b></dt><dd className="num"><b>{money(viewed.p.total)}</b></dd>
              <dt>Paid</dt><dd className="num">{money(viewed.p.paid)}</dd>
              {!viewed.p.cancelled_at && Number(viewed.p.total) - Number(viewed.p.paid) > 0 && (<><dt>Balance owed</dt><dd className="num warn">{money(round2(Number(viewed.p.total) - Number(viewed.p.paid)))}</dd></>)}
            </dl>
            {cancelling && !viewed.p.cancelled_at && (
              <div className="notice" style={{ display: 'grid', gap: 8 }}>
                <b>Cancel this purchase?</b>
                <span>The stock it added is taken back out{Number(viewed.p.paid) > 0 ? ` and the ${money(viewed.p.paid)} paid is put back into your accounts` : ''}{viewed.p.party_id && Number(viewed.p.total) - Number(viewed.p.paid) > 0 ? '. The balance you owed the supplier for it is removed' : ''}. Cost prices it updated are not changed back. This cannot be undone.</span>
                <input placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn danger" onClick={doCancel}>Cancel this purchase</button>
                  <button className="btn quiet" onClick={() => setCancelling(false)}>Keep purchase</button>
                </div>
                {cancelErr && <span className="err">{cancelErr}</span>}
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}

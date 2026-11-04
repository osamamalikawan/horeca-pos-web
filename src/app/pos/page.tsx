'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, moveStock, putRow } from '@/lib/db';
import { money, nextInvoiceNo, parseDiscount, qtyFmt, round2, uid } from '@/lib/util';
import { beep, printPage, RECEIPT_PAGE } from '@/lib/print';
import type { Kind, Party, Product } from '@/lib/types';
import Drawer from '@/components/Drawer';
import NumInput from '@/components/NumInput';
import { useProfile } from '@/components/ProfileProvider';
import { customerBalances } from '@/lib/ledger';
import PrintPortal from '@/components/PrintPortal';
import ReceiptView, { type Receipt } from '@/components/ReceiptView';
import { useSettings } from '@/components/SettingsProvider';
import { fieldLevel } from '@/lib/permissions';
import { usePosDrafts, MAX_DRAFTS, type Line, type Split } from '@/components/PosDrafts';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'cash', label: 'Cash' }, { kind: 'bank', label: 'Bank' },
  { kind: 'easypaisa', label: 'Easypaisa' }, { kind: 'jazzcash', label: 'JazzCash' },
];

export default function PosPage() {
  const { settings } = useSettings();
  const { can, legacy, profile } = useProfile();
  const canSell = can('pos.edit'), canDiscount = can('pos.discount'), canPrice = can('pos.price');
  const seeStock = fieldLevel(can, 'stock') !== 'hide';
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const owed = useLiveQuery(() => customerBalances(), []);
  const customers = useLiveQuery(() => db.parties.filter((p) => p.type === 'customer' && !p.deleted_at).toArray(), []);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [msg, setMsg] = useState('');
  // The open invoices live in PosDrafts so they stay when you visit another page.
  const { drafts, active, patchActive, switchTo, newDraft, closeDraft, finishDraft } = usePosDrafts();
  const { cart, billDisc, customer, cq, splits } = active;
  const setCart = (f: Line[] | ((c: Line[]) => Line[])) => patchActive((d) => ({ cart: typeof f === 'function' ? f(d.cart) : f }));
  const setBillDisc = (v: string) => patchActive(() => ({ billDisc: v }));
  const setCustomer = (v: Party | null) => patchActive(() => ({ customer: v }));
  const setCq = (v: string) => patchActive(() => ({ cq: v }));
  const setSplits = (f: Split[] | ((s: Split[]) => Split[])) => patchActive((d) => ({ splits: typeof f === 'function' ? f(d.splits) : f }));
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [printAfter, setPrintAfter] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sc = settings.scanner;

  // Scanner anywhere: typing with nothing focused goes to the search box.
  useEffect(() => {
    if (!sc.focusAnywhere) return;
    const k = (e: KeyboardEvent) => {
      const t = document.activeElement as HTMLElement | null;
      const typing = t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) searchRef.current?.focus();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sc.focusAnywhere]);

  useEffect(() => { setMsg(''); searchRef.current?.focus(); }, [active.id]);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    (products ?? []).forEach((p) => { const c = (p.category ?? '').trim(); if (c) m.set(c, (m.get(c) ?? 0) + 1); });
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 14).map(([c]) => c);
  }, [products]);
  const inCart = useMemo(() => new Map(cart.map((l) => [l.product_id, l.qty])), [cart]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = (products ?? []).filter((p) => !cat || (p.category ?? '').trim() === cat).sort((a, b) => a.name.localeCompare(b.name));
    return (s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? '').includes(s) || (p.short_code ?? '').toLowerCase().includes(s)) : all).slice(0, 80);
  }, [products, q, cat]);

  function add(p: Product) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product_id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { product_id: p.id, name: p.name, unit_price: p.sale_price, qty: 1, disc: '' }];
    });
  }

  function submitSearch(e?: React.KeyboardEvent) {
    const s = q.trim();
    if (!s) return;
    // a barcode or a short code that matches exactly goes straight onto the invoice
    const exact = (products ?? []).find((p) => p.barcode === s) ?? (products ?? []).find((p) => !!p.short_code && p.short_code.toLowerCase() === s.toLowerCase());
    const hit = exact ?? (list.length === 1 ? list[0] : undefined);
    if (hit) { add(hit); setQ(''); setMsg(''); if (exact && sc.beep) beep(true); e?.preventDefault(); }
    else { setMsg(`No product matches “${s}”`); if (sc.beep) beep(false); }
  }
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setQ(''); setMsg(''); return; }
    if (e.key === 'Enter' || (e.key === 'Tab' && sc.terminator === 'tab' && q.trim())) submitSearch(e);
  }
  // Scanners that send no Enter/Tab: add when the typing stops on an exact barcode.
  useEffect(() => {
    if (sc.terminator !== 'none') return;
    const s = q.trim();
    if (s.length < sc.minLength) return;
    const t = setTimeout(() => {
      const hit = (products ?? []).find((p) => p.barcode === s);
      if (hit) { add(hit); setQ(''); if (sc.beep) beep(true); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, products, sc.terminator, sc.minLength, sc.beep]);

  const patch = (i: number, p: Partial<Line>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const drop = (i: number) => setCart((c) => c.filter((_, j) => j !== i));

  // ---- totals
  const calc = useMemo(() => {
    const rows = cart.map((l) => {
      const gross = round2(l.qty * l.unit_price);
      const disc = parseDiscount(l.disc, gross);
      return { gross, disc, total: round2(gross - disc) };
    });
    const subtotal = round2(rows.reduce((s, r) => s + r.gross, 0));
    const itemDisc = round2(rows.reduce((s, r) => s + r.disc, 0));
    const afterItems = round2(subtotal - itemDisc);
    const bill = parseDiscount(billDisc, afterItems);
    return {
      rows, subtotal, itemDisc, billDisc: bill, discountTotal: round2(itemDisc + bill), total: round2(afterItems - bill),
      units: cart.reduce((s, l) => s + l.qty, 0),
    };
  }, [cart, billDisc]);

  // ---- split payment
  // One row: blank = the full total. Several rows: blank on the last row = whatever is still unpaid.
  const pay = useMemo(() => {
    const n = splits.length;
    const explicit = splits.map((s) => (s.amount === '' ? null : Math.max(Number(s.amount) || 0, 0)));
    const eff = splits.map((_, i) => {
      const e = explicit[i];
      if (e !== null) return e;
      if (n === 1) return calc.total;
      if (i === n - 1) {
        const others = explicit.reduce<number>((a, v, j) => (j === i ? a : a + (v ?? 0)), 0);
        return Math.max(round2(calc.total - others), 0);
      }
      return 0;
    });
    const received = round2(eff.reduce((a, b) => a + b, 0));
    const change = Math.max(round2(received - calc.total), 0);
    const cashIdx = splits.findIndex((s) => s.kind === 'cash');
    const cashAmt = cashIdx >= 0 ? eff[cashIdx] : 0;
    const changeOk = change === 0 || change <= cashAmt;
    const net = eff.map((a, i) => (i === cashIdx ? round2(a - change) : a));
    const paid = round2(net.reduce((a, b) => a + b, 0));
    return { eff, net, received, change, changeOk, paid, owed: Math.max(round2(calc.total - paid), 0) };
  }, [splits, calc.total]);

  const setSplit = (i: number, p: Partial<Split>) => setSplits((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  function addSplit() {
    setSplits((s) => {
      const used = new Set(s.map((r) => r.kind));
      const next = KINDS.find((k) => !used.has(k.kind));
      if (!next) return s;
      // make the first amount explicit so the new row can take the remainder
      const first = s[0].amount === '' ? { ...s[0], amount: String(calc.total) } : s[0];
      return [first, ...s.slice(1), { kind: next.kind, amount: '' }];
    });
  }
  const removeSplit = (i: number) => setSplits((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : s));
  const accountOf = (kind: Kind) => accounts?.find((a) => a.kind === kind);

  const custMatches = useMemo(() => {
    const s = cq.trim().toLowerCase();
    if (!s) return [];
    return (customers ?? []).filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s)).slice(0, 5);
  }, [customers, cq]);

  async function saveCustomer() {
    if (!newCust || !newCust.name.trim()) return;
    const row = await putRow('parties', {
      id: uid(), name: newCust.name.trim(), phone: newCust.phone.trim() || null, type: 'customer',
      created_at: new Date().toISOString(), deleted_at: null,
    });
    setCustomer(row as Party); setNewCust(null); setCq('');
  }

  async function complete(print: boolean) {
    if (!cart.length || !accounts?.length || !canSell || busy) return;
    if (pay.owed > 0 && !customer) { setMsg('Choose a customer to leave a balance unpaid.'); return; }
    if (!pay.changeOk) { setMsg('Received more than the total. Lower the non-cash amounts so change can be given in cash.'); return; }
    const used = splits.map((s, i) => ({ s, i, acc: accountOf(s.kind), amt: pay.net[i] }));
    if (used.some((u) => u.amt > 0 && !u.acc)) { setMsg('That payment account is not loaded yet. Press Sync now once while online.'); return; }
    setBusy(true); setMsg('');
    const draftId = active.id;
    try {
      const id = uid();
      const now = new Date().toISOString();
      const primary = [...used].sort((a, b) => b.amt - a.amt)[0]?.acc ?? accounts[0];
      let no = '';
      await db.transaction('rw', [db.invoices, db.invoice_items, db.stock_movements, db.products, db.transactions, db.outbox, db.meta], async () => {
        no = await nextInvoiceNo();
        await putRow('invoices', {
          id, invoice_no: no, party_id: customer?.id ?? null,
          subtotal: calc.subtotal, item_discount_total: calc.itemDisc, bill_discount: calc.billDisc,
          discount_total: calc.discountTotal, total: calc.total, paid: pay.paid, account_id: primary.id,
          item_count: cart.length, created_at: now, deleted_at: null,
          ...(legacy ? {} : { created_by: profile?.id ?? null, created_by_name: profile?.name || profile?.email || null }),
        });
        for (let i = 0; i < cart.length; i++) {
          const l = cart[i], r = calc.rows[i];
          await putRow('invoice_items', {
            id: uid(), invoice_id: id, product_id: l.product_id, name: l.name,
            qty: l.qty, unit_price: l.unit_price, discount: r.disc, line_total: r.total,
          });
          await moveStock(l.product_id, -l.qty, 'sale', id); // may take stock below zero
        }
        for (const u of used) {
          if (u.amt > 0 && u.acc) {
            await putRow('transactions', {
              id: uid(), account_id: u.acc.id, direction: 'in', amount: u.amt, type: 'sale',
              party_id: customer?.id ?? null, ref_id: id, note: no, created_at: now, deleted_at: null,
            });
          }
        }
      });
      setReceipt({
        no, date: now, customer,
        lines: cart.map((l, i) => ({ name: l.name, qty: l.qty, price: l.unit_price, disc: calc.rows[i].disc, total: calc.rows[i].total })),
        subtotal: calc.subtotal, itemDisc: calc.itemDisc, billDisc: calc.billDisc,
        discountTotal: calc.discountTotal, total: calc.total,
        payments: used.filter((u) => u.amt > 0 && u.acc).map((u) => ({ name: u.acc!.name, amount: u.amt })),
        change: pay.change, balance: pay.owed,
      });
      setPrintAfter(print || settings.receipt.autoPrint);
      finishDraft(draftId);   // this invoice is done: close its tab (or reset it if it is the only one)
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!receipt || !printAfter) return;
    const t = setTimeout(() => { printPage(RECEIPT_PAGE); setPrintAfter(false); }, 200);
    return () => clearTimeout(t);
  }, [receipt, printAfter]);

  // shortcuts: F2 = scan box, Ctrl+Enter = complete sale, Ctrl+Shift+Enter = complete and print
  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); completeRef.current(e.shiftKey); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  function clearInvoice() { patchActive(() => ({ cart: [], billDisc: '', splits: [{ kind: 'cash', amount: '' }], customer: null, cq: '' })); setMsg(''); searchRef.current?.focus(); }
  function closeReceipt() { setReceipt(null); setPrintAfter(false); searchRef.current?.focus(); }
  const noAccounts = accounts && accounts.length === 0;
  const ownes = customer ? owed?.[customer.id] ?? 0 : 0;
  const canComplete = !!cart.length && !busy && !!accounts?.length && canSell;

  return (
    <div className="pos">
      {/* left: scan, search and products */}
      <section className="pos-left">
        <div className="pos-bar">
          <input ref={searchRef} className="pos-search" value={q} autoFocus placeholder="Scan a barcode, type a short code or search"
            aria-label="Scan or search" onChange={(e) => { setQ(e.target.value); setMsg(''); }} onKeyDown={onSearchKey} />
          <div className="pos-hint">{msg ? <span className="err">{msg}</span> : <span className="mute">Scan or type, then Enter. F2 returns here. Alt+N new invoice, Alt+1 to 9 switch, Alt+K jump to a page.</span>}</div>
          {categories.length > 0 && (
            <div className="chips" role="group" aria-label="Category">
              <button className={'chipbtn' + (cat === '' ? ' on' : '')} onClick={() => setCat('')}>All</button>
              {categories.map((c) => <button key={c} className={'chipbtn' + (cat === c ? ' on' : '')} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
            </div>
          )}
        </div>
        {products && products.length === 0 ? (
          <div className="empty">No products yet. Add them on the Products page.</div>
        ) : list.length === 0 ? (
          <div className="empty">Nothing matches “{q}”.</div>
        ) : (
          <div className="pgrid">
            {list.map((p) => {
              const n = inCart.get(p.id);
              const low = p.stock_qty <= 0;
              return (
                <button key={p.id} className={'ptile' + (n ? ' in' : '')} onClick={() => { add(p); searchRef.current?.focus(); }}>
                  {n ? <span className="pbadge num">{qtyFmt(n)}</span> : null}
                  <span className="pname">{p.name}</span>
                  <span className="pprice num">{money(p.sale_price)}</span>
                  {seeStock && <span className={'pstock num' + (low ? ' low' : '')}>{low ? `Out of stock (${qtyFmt(p.stock_qty)})` : `${qtyFmt(p.stock_qty)} in stock`}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* right: the invoice */}
      <aside className="invoice">
        <div className="inv-tabs" role="tablist" aria-label="Open invoices">
          {drafts.map((d, i) => {
            const total = d.cart.reduce((s, l) => s + l.qty * l.unit_price, 0);
            return (
              <div key={d.id} role="tab" aria-selected={d.id === active.id} tabIndex={0} className={'inv-tab' + (d.id === active.id ? ' on' : '')}
                title={`Alt+${i + 1}`} onClick={() => switchTo(d.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTo(d.id); } }}>
                <span>#{d.n}{d.customer ? ` ${d.customer.name.split(' ')[0]}` : ''}{d.cart.length ? ` · ${money(total)}` : ''}</span>
                {drafts.length > 1 && (
                  <button className="x" aria-label={`Close invoice ${d.n}`} tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); if (!d.cart.length || window.confirm('Close this invoice? Its items will be removed.')) closeDraft(d.id); }}>×</button>
                )}
              </div>
            );
          })}
          {drafts.length < MAX_DRAFTS && <button className="inv-tab add" onClick={() => newDraft()} title="Alt+N" aria-label="New invoice">+</button>}
        </div>
        <div className="inv-head">
          <div className="inv-title">
            <h2>Invoice #{active.n}</h2>
            <span className="pill2 num">{cart.length} {cart.length === 1 ? 'product' : 'products'}, {qtyFmt(calc.units)} {calc.units === 1 ? 'unit' : 'units'}</span>
            {cart.length > 0 && <button className="btn small quiet" onClick={clearInvoice}>Clear</button>}
          </div>
          {customer ? (
            <div className="chip">
              <span><b>{customer.name}</b>{customer.phone ? <span className="mute">, {customer.phone}</span> : null}{ownes > 0.5 && <span className="warn num">, owes {money(ownes)}</span>}</span>
              <button className="x" onClick={() => setCustomer(null)} aria-label="Remove customer">×</button>
            </div>
          ) : newCust ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <input placeholder="Customer name" value={newCust.name} autoFocus onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              <input placeholder="Phone" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn small primary" onClick={saveCustomer} disabled={!newCust.name.trim()}>Save customer</button>
                <button className="btn small quiet" onClick={() => setNewCust(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <input placeholder="Customer name or phone (optional)" value={cq} onChange={(e) => setCq(e.target.value)} />
                <button className="btn small" style={{ height: 38 }} onClick={() => setNewCust({ name: /\d/.test(cq) ? '' : cq, phone: /\d/.test(cq) ? cq : '' })}>New</button>
              </div>
              {custMatches.length > 0 && (
                <div className="pick">
                  {custMatches.map((c) => (
                    <button key={c.id} onClick={() => { setCustomer(c); setCq(''); }}>
                      <span>{c.name}</span><span className="mute">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="lines">
          {cart.length === 0 && (
            <div className="inv-empty"><b>Ready for the next sale</b><span className="mute">Scan a barcode or tap a product.</span></div>
          )}
          {cart.map((l, i) => {
            const stock = byId.get(l.product_id)?.stock_qty ?? 0;
            const listPrice = byId.get(l.product_id)?.sale_price;
            return (
              <div className="pl" key={l.product_id}>
                <div className="pl-top">
                  <span className="pl-name">{l.name}</span>
                  <span className="pl-total num">{money(calc.rows[i].total)}</span>
                  <button className="x" onClick={() => drop(i)} aria-label={`Remove ${l.name}`}>×</button>
                </div>
                <div className="pl-ctl">
                  <div className="stepper">
                    <button className="step" onClick={() => { const n = round3(l.qty - 1); if (n > 0) patch(i, { qty: n }); else drop(i); }} aria-label="Less">−</button>
                    <NumInput className="num" label="Quantity" live decimals={3} value={l.qty} onCommit={(n) => patch(i, { qty: n })} />
                    <button className="step" onClick={() => patch(i, { qty: round3(l.qty + 1) })} aria-label="More">+</button>
                  </div>
                  <span className="times mute">×</span>
                  {canPrice
                    ? <NumInput className="num pl-price" label="Price" clearOnFocus value={l.unit_price} onCommit={(n) => patch(i, { unit_price: n })} />
                    : <b className="num">{money(l.unit_price)}</b>}
                  {canDiscount
                    ? <input className="pl-disc" aria-label="Discount" placeholder="Disc. 50 or 10%" value={l.disc} onChange={(e) => patch(i, { disc: e.target.value })} />
                    : <span />}
                </div>
                {((seeStock && l.qty > stock) || (listPrice !== undefined && listPrice !== l.unit_price)) && (
                  <div className="pl-note num">
                    {listPrice !== undefined && listPrice !== l.unit_price && <span className="mute">list price {money(listPrice)}</span>}
                    {seeStock && l.qty > stock && <span className="warn">stock will go to {qtyFmt(stock - l.qty)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pos-sum">
          <div className="r sub">
            <span className="mute">Subtotal <span className="num">{money(calc.subtotal)}</span></span>
            {calc.discountTotal > 0 && <span className="mute">Discount <span className="num">-{money(calc.discountTotal)}</span></span>}
          </div>
          {canDiscount && (
            <div className="r"><span className="mute">Bill discount</span>
              <input placeholder="50 or 10%" value={billDisc} aria-label="Bill discount" onChange={(e) => setBillDisc(e.target.value)} />
            </div>
          )}
          <div className="pos-total"><span>Total</span><span className="num">{money(calc.total)}</span></div>

          <div className="pay">
            <div className="pay-head">
              <span className="mute">Payment</span>
              {splits.length < KINDS.length && <button className="btn small quiet" onClick={addSplit}>Split payment</button>}
            </div>
            {splits.map((s, i) => (
              <div className="split-row" key={s.kind}>
                <select value={s.kind} onChange={(e) => setSplit(i, { kind: e.target.value as Kind })} aria-label="Payment method">
                  {KINDS.filter((k) => k.kind === s.kind || !splits.some((r) => r.kind === k.kind)).map((k) => (
                    <option key={k.kind} value={k.kind}>{k.label}</option>
                  ))}
                </select>
                <input inputMode="decimal" className="num" aria-label="Amount" value={s.amount}
                  placeholder={String(pay.eff[i] ?? 0)} onChange={(e) => setSplit(i, { amount: e.target.value })} />
                {splits.length > 1 ? <button className="x" onClick={() => removeSplit(i)} aria-label="Remove payment">×</button> : <span />}
              </div>
            ))}
            {noAccounts && <div className="err">Accounts are not loaded yet. Connect to the internet and press Sync now once.</div>}
            {pay.change > 0 && <div className="r"><span className="mute">Change to give back</span><b className="num">{money(pay.change)}</b></div>}
            {pay.owed > 0 && <div className="r"><span className="mute">Balance left on customer</span><span className="num warn">{money(pay.owed)}</span></div>}
          </div>
          <div className="pos-actions">
            <button className="btn primary pos-go" disabled={!canComplete} onClick={() => complete(false)} title="Ctrl+Enter">
              {busy ? 'Saving…' : <>Complete sale <span className="num">{money(calc.total)}</span></>}
            </button>
            <button className="btn pos-print" disabled={!canComplete} onClick={() => complete(true)} title="Ctrl+Shift+Enter">Complete and print</button>
          </div>
        </div>
      </aside>

      <Drawer open={!!receipt} onClose={closeReceipt} title="Sale complete"
        footer={<><button className="btn quiet" onClick={closeReceipt}>New sale</button><button className="btn primary" onClick={() => printPage(RECEIPT_PAGE)}>Print invoice</button></>}>
        {receipt && <ReceiptView r={receipt} store={settings.store} paperMm={settings.receipt.paperMm} />}
      </Drawer>
      {receipt && (
        <PrintPortal><ReceiptView r={receipt} store={settings.store} paperMm={settings.receipt.paperMm} /></PrintPortal>
      )}
    </div>
  );
}

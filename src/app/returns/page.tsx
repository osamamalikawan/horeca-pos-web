'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { money, qtyFmt, round2 } from '@/lib/util';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import { createReturn, loadInvoice, settleReturn, unitRefund } from '@/lib/invoices';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import PeriodTabs from '@/components/PeriodTabs';
import InvoiceDetail from '@/components/InvoiceDetail';
import AccountPicker, { defaultAccountId } from '@/components/AccountPicker';

export default function ReturnsPage() {
  const canEdit = useProfile().can('returns.edit');
  const data = useLiveQuery(async () => {
    const [inv, parties, rets, accounts] = await Promise.all([
      db.invoices.filter((i) => !i.deleted_at).toArray(),
      db.parties.toArray(),
      db.sale_returns.filter((r) => !r.deleted_at).toArray(),
      db.accounts.toArray(),
    ]);
    return { inv, parties, rets, accounts };
  }, []);

  const [period, setPeriod] = useState<Period>('month');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [invoiceId, setInvoiceId] = useState<string | null>(null);   // new return
  const [viewId, setViewId] = useState<string | null>(null);         // existing return
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const bundle = useLiveQuery(() => (invoiceId ? loadInvoice(invoiceId) : undefined), [invoiceId]);
  const viewed = useLiveQuery(async () => {
    if (!viewId) return undefined;
    const r = await db.sale_returns.get(viewId);
    if (!r) return undefined;
    const items = await db.sale_return_items.where('return_id').equals(viewId).toArray();
    const b = await loadInvoice(r.invoice_id);
    return { r, items, b };
  }, [viewId]);

  function startReturn(id: string) { if (!canEdit) return; setInvoiceId(id); setQtys({}); setNote(''); setErr(''); setAccountId(''); setQ(''); }
  // opened from the Sales page: /returns/?invoice=...
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('invoice');
    if (id) startReturn(id);
  }, []);

  const party = useMemo(() => new Map((data?.parties ?? []).map((p) => [p.id, p])), [data]);
  const invNo = useMemo(() => new Map((data?.inv ?? []).map((i) => [i.id, i.invoice_no])), [data]);
  const accName = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a.name])), [data]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return [];
    return data.inv.filter((i) => !i.cancelled_at).filter((i) => {
      const p = i.party_id ? party.get(i.party_id) : null;
      return i.invoice_no.toLowerCase().includes(s) || (p?.name.toLowerCase().includes(s) ?? false) || (p?.phone ?? '').includes(s);
    }).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  }, [q, data, party]);

  const rows = useMemo(
    () => (data?.rets ?? []).filter((r) => inPeriod(r.created_at, period)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data, period],
  );
  const rowsTotal = round2(rows.reduce((s, r) => s + Number(r.total), 0));

  // ---- new return: figures for every line
  const calc = useMemo(() => {
    if (!bundle) return null;
    const lines = bundle.items.map((it) => {
      const left = Math.max(Number(it.qty) - (bundle.returnedQty[it.id] ?? 0), 0);
      const want = Math.min(Math.max(Number(qtys[it.id]) || 0, 0), left);
      const unit = unitRefund(bundle.invoice, it);
      return { it, left, want, unit, refund: round2(unit * want) };
    });
    const picked = lines.filter((l) => l.want > 0);
    const value = round2(picked.reduce((s, l) => s + l.refund, 0));
    return { lines, picked, value, units: picked.reduce((s, l) => s + l.want, 0), ...settleReturn(bundle, value) };
  }, [bundle, qtys]);

  const acc = accountId || defaultAccountId(data?.accounts);

  async function save() {
    if (!bundle || !calc) return;
    setBusy(true); setErr('');
    try {
      await createReturn({
        invoiceId: bundle.invoice.id, accountId: acc || null, note,
        lines: calc.picked.map((l) => ({ itemId: l.it.id, qty: l.want })),
      });
      setInvoiceId(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  const mark: Record<string, number> = {};
  viewed?.items.forEach((i) => { mark[i.invoice_item_id] = (mark[i.invoice_item_id] ?? 0) + Number(i.qty); });

  return (
    <>
      <div className="head">
        <div>
          <h1>Returns</h1>
          <div className="mute num">{rows.length} {rows.length === 1 ? 'return' : 'returns'}, {money(rowsTotal)}</div>
        </div>
        <div className="tools"><PeriodTabs value={period} onChange={setPeriod} /></div>
      </div>

      {canEdit && <div style={{ maxWidth: 520, marginBottom: 20, display: 'grid', gap: 6 }}>
        <input placeholder="Find the invoice to return items from: number, customer or phone" value={q}
          onChange={(e) => { setQ(e.target.value); setMsg(''); }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const exact = matches.find((m) => m.invoice_no.toLowerCase() === q.trim().toLowerCase());
            const hit = exact ?? (matches.length === 1 ? matches[0] : undefined);
            if (hit) startReturn(hit.id); else setMsg(matches.length ? 'Choose an invoice from the list.' : 'No invoice found.');
          }} />
        {msg && <div className="err">{msg}</div>}
        {matches.length > 0 && (
          <div className="pick">
            {matches.map((i) => {
              const p = i.party_id ? party.get(i.party_id) : null;
              return (
                <button key={i.id} onClick={() => startReturn(i.id)}>
                  <span className="num">{i.invoice_no} <span className="mute">{shortDate(i.created_at)}</span></span>
                  <span>{p?.name ?? 'Walk-in'}, <span className="num">{money(i.total)}</span></span>
                </button>
              );
            })}
          </div>
        )}
      </div>}

      {rows.length === 0 ? (
        <div className="empty">No returns in this period.</div>
      ) : (
        <table>
          <thead><tr><th>Return</th><th>Date</th><th>Invoice</th><th>Customer</th><th className="right">Value</th><th className="right">Refunded</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setViewId(r.id)}>
                <td className="num">{r.return_no}</td>
                <td className="num mute">{shortDate(r.created_at)}</td>
                <td className="num">{invNo.get(r.invoice_id) ?? ''}</td>
                <td>{r.party_id ? party.get(r.party_id)?.name ?? '' : <span className="mute">Walk-in</span>}</td>
                <td className="right num">{money(r.total)}</td>
                <td className="right num">{Number(r.cash_refund) > 0 ? money(r.cash_refund) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* new return */}
      <Drawer open={!!invoiceId} onClose={() => setInvoiceId(null)} wide
        title={bundle ? `Return from ${bundle.invoice.invoice_no}` : 'Return'}
        footer={calc && (
          <>
            <span className="mute num">{calc.picked.length} {calc.picked.length === 1 ? 'product' : 'products'}, {qtyFmt(calc.units)} {calc.units === 1 ? 'unit' : 'units'}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn quiet" onClick={() => setInvoiceId(null)}>Cancel</button>
              <button className="btn primary" disabled={!calc.picked.length || busy} onClick={save}>{busy ? 'Saving…' : `Complete return, ${money(calc.value)}`}</button>
            </span>
          </>
        )}>
        {bundle && calc && bundle.invoice.cancelled_at && <div className="err">This invoice was cancelled, so nothing can be returned.</div>}
        {bundle && calc && !bundle.invoice.cancelled_at && (
          <>
            <dl className="kv" style={{ textAlign: 'left' }}>
              <dt>Customer</dt><dd>{bundle.party ? `${bundle.party.name}${bundle.party.phone ? `, ${bundle.party.phone}` : ''}` : 'Walk-in'}</dd>
              <dt>Invoice date</dt><dd className="num">{new Date(bundle.invoice.created_at).toLocaleString()}</dd>
              <dt>Invoice total</dt><dd className="num">{money(bundle.invoice.total)}, paid {money(bundle.invoice.paid)}</dd>
            </dl>
            <table className="plain">
              <thead><tr><th>Item</th><th className="right">Sold</th><th className="right">Returned</th><th className="right">Return qty</th><th className="right">Refund</th></tr></thead>
              <tbody>
                {calc.lines.map(({ it, left, want, refund }) => (
                  <tr key={it.id} className={want > 0 ? 'hl' : ''}>
                    <td>
                      {it.name}
                      <div className="mute num" style={{ fontSize: 12 }}>{money(it.unit_price)} each{Number(it.discount) > 0 ? `, discount ${money(it.discount)}` : ''}</div>
                    </td>
                    <td className="right num">{qtyFmt(Number(it.qty))}</td>
                    <td className="right num">{qtyFmt(bundle.returnedQty[it.id] ?? 0)}</td>
                    <td className="right">
                      {left > 0 ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input className="num" style={{ width: 64, height: 30, textAlign: 'right' }} inputMode="decimal" aria-label={`Return quantity for ${it.name}`}
                            value={qtys[it.id] ?? ''} placeholder="0"
                            onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setQtys({ ...qtys, [it.id]: e.target.value }); }} />
                          <button className="btn small quiet" onClick={() => setQtys({ ...qtys, [it.id]: String(left) })}>All</button>
                        </span>
                      ) : <span className="mute">All returned</span>}
                    </td>
                    <td className="right num">{want > 0 ? <b>{money(refund)}</b> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={calc.picked.length ? 'summary hl' : 'summary'}>
              <h2>Return details</h2>
              {calc.picked.length === 0 ? <div className="mute">Enter a quantity next to the items being returned.</div> : (
                <>
                  {calc.picked.map((l) => (
                    <div className="rl2" key={l.it.id}><span>{l.it.name} × {qtyFmt(l.want)}</span><span className="num">{money(l.refund)}</span></div>
                  ))}
                  <div className="rl2"><b>Value of returned items</b><b className="num">{money(calc.value)}</b></div>
                  {calc.cash > 0 && <div className="rl2"><span>Money paid back</span><span className="num">{money(calc.cash)}</span></div>}
                  {calc.credit > 0 && <div className="rl2"><span>Taken off what the customer owes</span><span className="num">{money(calc.credit)}</span></div>}
                </>
              )}
            </div>
            {calc.cash > 0 && (
              <label>Refund paid from
                <AccountPicker accounts={data?.accounts} value={accountId} onChange={setAccountId} />
              </label>
            )}
            <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the return (optional)" /></label>
            {err && <div className="err">{err}</div>}
          </>
        )}
      </Drawer>

      {/* existing return */}
      <Drawer open={!!viewId} onClose={() => setViewId(null)} wide title={viewed ? `Return ${viewed.r.return_no}` : 'Return'}>
        {viewed && viewed.b && (
          <>
            <dl className="kv" style={{ textAlign: 'left' }}>
              <dt>Return date</dt><dd className="num">{new Date(viewed.r.created_at).toLocaleString()}</dd>
              <dt>Value of returned items</dt><dd className="num"><b>{money(viewed.r.total)}</b></dd>
              <dt>Money paid back</dt><dd className="num">{Number(viewed.r.cash_refund) > 0 ? `${money(viewed.r.cash_refund)}${viewed.r.account_id ? ` from ${accName.get(viewed.r.account_id) ?? ''}` : ''}` : 'None'}</dd>
              <dt>Taken off customer balance</dt><dd className="num">{Number(viewed.r.credit_adjust) > 0 ? money(viewed.r.credit_adjust) : 'None'}</dd>
              {viewed.r.note && (<><dt>Note</dt><dd>{viewed.r.note}</dd></>)}
            </dl>
            <h2>Invoice, returned items highlighted</h2>
            <InvoiceDetail b={viewed.b} mark={mark} markLabel="Returned in this return" />
          </>
        )}
      </Drawer>
    </>
  );
}

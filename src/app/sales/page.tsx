'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { money, round2 } from '@/lib/util';
import { inPeriod, shortDate, type Period } from '@/lib/period';
import { cancelInvoice, loadInvoice, toReceipt } from '@/lib/invoices';
import { printPage, RECEIPT_PAGE } from '@/lib/print';
import Drawer from '@/components/Drawer';
import { useProfile } from '@/components/ProfileProvider';
import PeriodTabs from '@/components/PeriodTabs';
import InvoiceDetail from '@/components/InvoiceDetail';
import PrintPortal from '@/components/PrintPortal';
import ReceiptView from '@/components/ReceiptView';
import { useSettings } from '@/components/SettingsProvider';

export default function SalesPage() {
  const { settings } = useSettings();
  const { can } = useProfile();
  const data = useLiveQuery(async () => {
    const [inv, parties, rets] = await Promise.all([
      db.invoices.filter((i) => !i.deleted_at).toArray(),
      db.parties.toArray(),
      db.sale_returns.filter((r) => !r.deleted_at).toArray(),
    ]);
    return { inv, parties, rets };
  }, []);

  const [period, setPeriod] = useState<Period>('today');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const bundle = useLiveQuery(() => (openId ? loadInvoice(openId) : undefined), [openId]);

  const view = useMemo(() => {
    if (!data) return null;
    const party = new Map(data.parties.map((p) => [p.id, p]));
    const returned: Record<string, number> = {};
    data.rets.forEach((r) => { returned[r.invoice_id] = (returned[r.invoice_id] ?? 0) + Number(r.total); });
    const s = q.trim().toLowerCase();
    const rows = data.inv
      .filter((i) => inPeriod(i.created_at, period))
      .filter((i) => {
        if (!s) return true;
        const p = i.party_id ? party.get(i.party_id) : null;
        return i.invoice_no.toLowerCase().includes(s) || (p?.name.toLowerCase().includes(s) ?? false) || (p?.phone ?? '').includes(s);
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 500);
    const live = rows.filter((i) => !i.cancelled_at);
    return { rows, party, returned, total: round2(live.reduce((t, i) => t + Number(i.total), 0)), count: live.length };
  }, [data, period, q]);

  function open(id: string) { setOpenId(id); setCancelling(false); setReason(''); setErr(''); }
  function close() { setOpenId(null); setCancelling(false); }

  async function doCancel() {
    if (!openId) return;
    try { await cancelInvoice(openId, reason); setCancelling(false); setErr(''); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  const hasReturns = !!bundle && bundle.returns.length > 0;
  const cancelled = !!bundle?.invoice.cancelled_at;
  const receipt = bundle ? toReceipt(bundle) : null;
  const status = (id: string, cancelledAt?: string | null) =>
    cancelledAt ? 'Cancelled' : view && (view.returned[id] ?? 0) > 0 ? 'Has returns' : 'Completed';

  return (
    <>
      <div className="head">
        <div>
          <h1>Sales</h1>
          <div className="mute num">{view ? `${view.count} ${view.count === 1 ? 'invoice' : 'invoices'}, ${money(view.total)}` : ' '}</div>
        </div>
        <div className="tools">
          <input style={{ width: 260 }} placeholder="Invoice number, customer or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <PeriodTabs value={period} onChange={setPeriod} />
        </div>
      </div>

      {view && view.rows.length === 0 ? (
        <div className="empty">No sales found for this period.</div>
      ) : (
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Cashier</th><th className="right">Products</th><th className="right">Total</th><th className="right">Paid</th><th>Status</th></tr></thead>
          <tbody>
            {view?.rows.map((i) => {
              const p = i.party_id ? view.party.get(i.party_id) : null;
              const st = status(i.id, i.cancelled_at);
              return (
                <tr key={i.id} onClick={() => open(i.id)} style={i.cancelled_at ? { color: 'var(--mute)' } : undefined}>
                  <td className="num">{i.invoice_no}</td>
                  <td className="num mute">{shortDate(i.created_at)}</td>
                  <td>{p?.name ?? <span className="mute">Walk-in</span>}</td>
                  <td className="mute">{i.created_by_name ?? ''}</td>
                  <td className="right num">{i.item_count}</td>
                  <td className="right num" style={i.cancelled_at ? { textDecoration: 'line-through' } : undefined}>{money(i.total)}</td>
                  <td className="right num">{i.cancelled_at ? '' : money(i.paid)}</td>
                  <td className={st === 'Cancelled' ? 'warn' : st === 'Has returns' ? '' : 'mute'}>{st}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Drawer open={!!openId} onClose={close} wide title={bundle ? `Invoice ${bundle.invoice.invoice_no}` : 'Invoice'}
        footer={bundle && (
          <>
            <span style={{ display: 'flex', gap: 8 }}>
              {!cancelled && !cancelling && can('sales.cancel') && (
                <button className="btn danger" onClick={() => { setCancelling(true); setErr(''); }}>Cancel sale</button>
              )}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              {!cancelled && can('returns.edit') && <Link className="btn" href={`/returns/?invoice=${bundle.invoice.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>Return items</Link>}
              <button className="btn primary" onClick={() => printPage(RECEIPT_PAGE)}>Print invoice</button>
            </span>
          </>
        )}>
        {bundle && (
          <>
            <InvoiceDetail b={bundle} />
            {hasReturns && (
              <div style={{ display: 'grid', gap: 6 }}>
                <h2>Returns on this invoice</h2>
                <table className="plain">
                  <tbody>
                    {bundle.returns.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{r.return_no}</td>
                        <td className="num mute">{shortDate(r.created_at)}</td>
                        <td className="right num">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cancelling && (
              <div className="notice" style={{ display: 'grid', gap: 8 }}>
                <b>Cancel this sale?</b>
                <span>All items go back into stock{Number(bundle.invoice.paid) > 0 ? ` and the ${money(bundle.invoice.paid)} received is removed from your accounts` : ''}. This cannot be undone.</span>
                {hasReturns
                  ? <span className="err">This invoice has returns, so it cannot be cancelled.</span>
                  : (
                    <>
                      <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn danger" onClick={doCancel}>Cancel this sale</button>
                        <button className="btn quiet" onClick={() => setCancelling(false)}>Keep sale</button>
                      </div>
                    </>
                  )}
                {err && <span className="err">{err}</span>}
              </div>
            )}
          </>
        )}
      </Drawer>
      {receipt && <PrintPortal><ReceiptView r={receipt} store={settings.store} paperMm={settings.receipt.paperMm} /></PrintPortal>}
    </>
  );
}

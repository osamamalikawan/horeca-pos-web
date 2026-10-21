import { money, qtyFmt, round2 } from '@/lib/util';
import type { InvoiceBundle } from '@/lib/invoices';

/**
 * Invoice header, lines and totals.
 * mark: invoice item id -> units to highlight (units being returned now, or returned in a given return).
 * Without mark, lines that were returned earlier are highlighted.
 */
export default function InvoiceDetail({ b, mark, markLabel }: {
  b: InvoiceBundle; mark?: Record<string, number>; markLabel?: string;
}) {
  const inv = b.invoice;
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const due = inv.cancelled_at ? 0 : Math.max(round2(Number(inv.total) - Number(inv.paid)), 0);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <dl className="kv" style={{ textAlign: 'left' }}>
        <dt>Invoice</dt><dd className="num">{inv.invoice_no}</dd>
        <dt>Date</dt><dd className="num">{new Date(inv.created_at).toLocaleString()}</dd>
        <dt>Customer</dt><dd>{b.party ? `${b.party.name}${b.party.phone ? `, ${b.party.phone}` : ''}` : 'Walk-in'}</dd>
        {inv.created_by_name && (<><dt>Sold by</dt><dd>{inv.created_by_name}</dd></>)}
        {inv.cancelled_at && (<><dt>Status</dt><dd className="warn">Cancelled{inv.cancel_reason ? `, ${inv.cancel_reason}` : ''}</dd></>)}
      </dl>

      <table className="plain">
        <thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Price</th><th className="right">Discount</th><th className="right">Total</th></tr></thead>
        <tbody>
          {b.items.map((it) => {
            const marked = mark ? (mark[it.id] ?? 0) > 0 : (b.returnedQty[it.id] ?? 0) > 0;
            const tagQty = mark ? mark[it.id] : b.returnedQty[it.id];
            return (
              <tr key={it.id} className={marked ? 'hl' : ''}>
                <td>
                  {it.name}
                  {marked && <div className="tag">{markLabel ?? 'Returned'} {qtyFmt(tagQty ?? 0)}</div>}
                </td>
                <td className="right num">{qtyFmt(Number(it.qty))}</td>
                <td className="right num">{money(it.unit_price)}</td>
                <td className="right num">{Number(it.discount) > 0 ? money(it.discount) : ''}</td>
                <td className="right num">{money(it.line_total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="kv">
        <dt>Total products</dt><dd className="num">{b.items.length}</dd>
        <dt>Subtotal</dt><dd className="num">{money(inv.subtotal)}</dd>
        <dt>Total discount</dt><dd className="num">{money(inv.discount_total)}</dd>
        <dt><b>Total</b></dt><dd className="num"><b>{money(inv.total)}</b></dd>
        {b.payments.map((p, i) => (<><dt key={'n' + i}>Paid by {p.name}</dt><dd key={'v' + i} className="num">{money(p.amount)}</dd></>))}
        {!inv.cancelled_at && due > 0 && (<><dt>Balance due</dt><dd className="num warn">{money(due)}</dd></>)}
        {b.returnedValue > 0 && (<><dt>Returned so far</dt><dd className="num">{money(b.returnedValue)}</dd></>)}
        {paid === 0 && !inv.cancelled_at && Number(inv.paid) === 0 && (<><dt>Payment</dt><dd>None, on credit</dd></>)}
      </dl>
    </div>
  );
}

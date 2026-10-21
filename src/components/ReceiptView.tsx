import { money, qtyFmt } from '@/lib/util';
import type { Party } from '@/lib/types';
import type { Settings } from '@/lib/settings';

export interface Receipt {
  no: string; date: string; customer: Party | null;
  lines: { name: string; qty: number; price: number; disc: number; total: number }[];
  subtotal: number; itemDisc: number; billDisc: number; discountTotal: number; total: number;
  payments: { name: string; amount: number }[]; change: number; balance: number; cancelled?: boolean;
}

export default function ReceiptView({ r, store, paperMm }: { r: Receipt; store: Settings['store']; paperMm: number }) {
  return (
    <div className="receipt" style={{ width: `${Math.max(paperMm - 6, 40)}mm` }}>
      {r.cancelled && <div className="rc-band" style={{ fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>CANCELLED</div>}
      <div className="rc-band">
        <div style={{ fontWeight: 700, fontSize: 15 }}>{store.name}</div>
        {store.address && <div>{store.address}</div>}
        {store.phone && <div>{store.phone}</div>}
      </div>
      <div className="rl"><span>{r.no}</span><span>{new Date(r.date).toLocaleString()}</span></div>
      {r.customer && <div>{r.customer.name}{r.customer.phone ? `, ${r.customer.phone}` : ''}</div>}
      <hr />
      {r.lines.map((l, i) => (
        <div key={i}>
          <div className="rl"><span>{l.name}</span><span className="num">{money(l.total)}</span></div>
          <div className="mute num">{qtyFmt(l.qty)} × {money(l.price)}{l.disc > 0 ? `, discount ${money(l.disc)}` : ''}</div>
        </div>
      ))}
      <hr />
      <div className="rl"><span>Total products</span><span className="num">{r.lines.length}</span></div>
      <div className="rl"><span>Total quantity</span><span className="num">{qtyFmt(r.lines.reduce((a, l) => a + l.qty, 0))}</span></div>
      <div className="rl"><span>Subtotal</span><span className="num">{money(r.subtotal)}</span></div>
      <div className="rl"><span>Total discount</span><span className="num">{money(r.discountTotal)}</span></div>
      <div className="rc-band rl"><span>Total</span><span className="num">{money(r.total)}</span></div>
      {r.payments.map((p, i) => (
        <div className="rl" key={i}><span>Paid by {p.name}</span><span className="num">{money(p.amount)}</span></div>
      ))}
      {r.change > 0 && <div className="rl"><span>Change</span><span className="num">{money(r.change)}</span></div>}
      {r.balance > 0 && <div className="rl"><span>Balance due</span><span className="num">{money(r.balance)}</span></div>}
      {store.footer && (<><hr /><div style={{ textAlign: 'center' }}>{store.footer}</div></>)}
      <div className="rc-credit">Software Developed by Osama Malik 0308-2877001</div>
    </div>
  );
}

import { db, moveStock, putRow } from './db';
import { nextNo, round2, uid } from './util';
import type { Invoice, InvoiceItem, Party, SaleReturn } from './types';
import type { Receipt } from '@/components/ReceiptView';

export interface InvoiceBundle {
  invoice: Invoice; items: InvoiceItem[]; party: Party | null;
  payments: { name: string; amount: number }[];
  returns: SaleReturn[];
  returnedQty: Record<string, number>;   // invoice item id -> units already returned
  returnedValue: number;                 // value of goods already returned
  cashRefunded: number;                  // money already paid back for those returns
}

export async function loadInvoice(id: string): Promise<InvoiceBundle | null> {
  const invoice = await db.invoices.get(id);
  if (!invoice) return null;
  const [items, txs, accounts, returns] = await Promise.all([
    db.invoice_items.where('invoice_id').equals(id).toArray(),
    db.transactions.where('ref_id').equals(id).filter((t) => t.type === 'sale' && !t.deleted_at).toArray(),
    db.accounts.toArray(),
    db.sale_returns.where('invoice_id').equals(id).filter((r) => !r.deleted_at).toArray(),
  ]);
  items.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const party = invoice.party_id ? (await db.parties.get(invoice.party_id)) ?? null : null;
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const retItems = returns.length ? await db.sale_return_items.where('return_id').anyOf(returns.map((r) => r.id)).toArray() : [];
  const returnedQty: Record<string, number> = {};
  retItems.forEach((ri) => { returnedQty[ri.invoice_item_id] = (returnedQty[ri.invoice_item_id] ?? 0) + Number(ri.qty); });
  return {
    invoice, items, party,
    payments: txs.map((t) => ({ name: accName.get(t.account_id) ?? 'Account', amount: Number(t.amount) })),
    returns, returnedQty,
    returnedValue: round2(returns.reduce((s, r) => s + Number(r.total), 0)),
    cashRefunded: round2(returns.reduce((s, r) => s + Number(r.cash_refund), 0)),
  };
}

export function toReceipt(b: InvoiceBundle): Receipt {
  const inv = b.invoice;
  const cancelled = !!inv.cancelled_at;
  return {
    no: inv.invoice_no, date: inv.created_at, customer: b.party, cancelled,
    lines: b.items.map((it) => ({
      name: it.name, qty: Number(it.qty), price: Number(it.unit_price), disc: Number(it.discount), total: Number(it.line_total),
    })),
    subtotal: Number(inv.subtotal), itemDisc: Number(inv.item_discount_total), billDisc: Number(inv.bill_discount),
    discountTotal: Number(inv.discount_total), total: Number(inv.total),
    payments: b.payments, change: 0,
    balance: cancelled ? 0 : Math.max(round2(Number(inv.total) - Number(inv.paid)), 0),
  };
}

/** Cancel a sale: stock goes back, its payments are voided. Not allowed once items were returned. */
export async function cancelInvoice(id: string, reason: string) {
  const now = new Date().toISOString();
  await db.transaction('rw', db.tables, async () => {
    const inv = await db.invoices.get(id);
    if (!inv) throw new Error('Invoice not found.');
    if (inv.cancelled_at) throw new Error('This invoice is already cancelled.');
    const rets = await db.sale_returns.where('invoice_id').equals(id).filter((r) => !r.deleted_at).count();
    if (rets) throw new Error('This invoice has returns, so it cannot be cancelled.');
    await putRow('invoices', { ...inv, cancelled_at: now, cancel_reason: reason.trim() || null });
    const items = await db.invoice_items.where('invoice_id').equals(id).toArray();
    for (const it of items) await moveStock(it.product_id, Number(it.qty), 'cancel', id);
    const txs = await db.transactions.where('ref_id').equals(id).filter((t) => t.type === 'sale' && !t.deleted_at).toArray();
    for (const t of txs) await putRow('transactions', { ...t, deleted_at: now });
  });
}

/** What the customer actually paid for one unit, after item and bill discounts. */
export function unitRefund(inv: Invoice, it: InvoiceItem) {
  const afterItems = Number(inv.subtotal) - Number(inv.item_discount_total);
  const ratio = afterItems > 0 ? Number(inv.total) / afterItems : 1;
  return (Number(it.line_total) / Number(it.qty)) * ratio;
}

/**
 * Split a return between money paid back and a reduction of what the customer still owes.
 * Money goes back only for the part of the invoice that was actually paid.
 */
export function settleReturn(b: InvoiceBundle, value: number) {
  const paidNet = Number(b.invoice.paid) - b.cashRefunded;
  const newEffective = Number(b.invoice.total) - b.returnedValue - value;
  const cash = Math.min(Math.max(round2(paidNet - newEffective), 0), value);
  return { cash: round2(cash), credit: round2(value - cash) };
}

export async function createReturn(a: {
  invoiceId: string; lines: { itemId: string; qty: number }[]; accountId: string | null; note: string;
}): Promise<SaleReturn> {
  const now = new Date().toISOString();
  let result!: SaleReturn;
  await db.transaction('rw', db.tables, async () => {
    const b = await loadInvoice(a.invoiceId);
    if (!b) throw new Error('Invoice not found.');
    if (b.invoice.cancelled_at) throw new Error('This invoice was cancelled.');
    const picked = a.lines.filter((l) => l.qty > 0).map((l) => {
      const it = b.items.find((x) => x.id === l.itemId);
      if (!it) throw new Error('Item not on this invoice.');
      const left = Number(it.qty) - (b.returnedQty[it.id] ?? 0);
      if (l.qty > left + 1e-9) throw new Error(`Only ${left} of “${it.name}” can still be returned.`);
      return { it, qty: l.qty, refund: round2(unitRefund(b.invoice, it) * l.qty) };
    });
    if (!picked.length) throw new Error('Choose at least one item to return.');
    const value = round2(picked.reduce((s, p) => s + p.refund, 0));
    const { cash, credit } = settleReturn(b, value);
    if (cash > 0 && !a.accountId) throw new Error('Choose the account the refund is paid from.');
    const id = uid();
    const no = await nextNo('returnSeq', 'R-');
    result = (await putRow('sale_returns', {
      id, return_no: no, invoice_id: b.invoice.id, party_id: b.invoice.party_id, total: value,
      cash_refund: cash, credit_adjust: credit, account_id: cash > 0 ? a.accountId : null,
      note: a.note.trim() || null, created_at: now, deleted_at: null,
    })) as SaleReturn;
    for (const p of picked) {
      await putRow('sale_return_items', {
        id: uid(), return_id: id, invoice_item_id: p.it.id, product_id: p.it.product_id, name: p.it.name,
        qty: p.qty, unit_price: Number(p.it.unit_price), refund: p.refund,
      });
      await moveStock(p.it.product_id, p.qty, 'return', id);
    }
    if (cash > 0) {
      await putRow('transactions', {
        id: uid(), account_id: a.accountId, direction: 'out', amount: cash, type: 'refund',
        party_id: b.invoice.party_id, ref_id: id, note: no, created_at: now, deleted_at: null,
      });
    }
  });
  return result;
}

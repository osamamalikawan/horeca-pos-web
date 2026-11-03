import { db, moveStock, putRow } from './db';
import { nextNo, round2, uid } from './util';
import type { Party, Purchase, PurchaseItem, PurchaseReturn } from './types';

export interface PurchaseBundle {
  purchase: Purchase; items: PurchaseItem[]; supplier: Party | null;
  returns: PurchaseReturn[];
  returnedQty: Record<string, number>;   // purchase item id -> units already sent back
  returnedValue: number;                 // value of goods already sent back
  cashRefunded: number;                  // money the supplier already paid back for them
}

export async function loadPurchase(id: string): Promise<PurchaseBundle | null> {
  const purchase = await db.purchases.get(id);
  if (!purchase) return null;
  const [items, returns] = await Promise.all([
    db.purchase_items.where('purchase_id').equals(id).toArray(),
    db.purchase_returns.where('purchase_id').equals(id).filter((r) => !r.deleted_at).toArray(),
  ]);
  items.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const supplier = purchase.party_id ? (await db.parties.get(purchase.party_id)) ?? null : null;
  const retItems = returns.length ? await db.purchase_return_items.where('return_id').anyOf(returns.map((r) => r.id)).toArray() : [];
  const returnedQty: Record<string, number> = {};
  retItems.forEach((ri) => { returnedQty[ri.purchase_item_id] = (returnedQty[ri.purchase_item_id] ?? 0) + Number(ri.qty); });
  return {
    purchase, items, supplier, returns, returnedQty,
    returnedValue: round2(returns.reduce((s, r) => s + Number(r.total), 0)),
    cashRefunded: round2(returns.reduce((s, r) => s + Number(r.cash_refund), 0)),
  };
}

/** What one unit cost on this purchase. */
export const unitCostPaid = (it: PurchaseItem) => Number(it.line_total) / Number(it.qty);

/**
 * The most the supplier can pay back in money: only the part of the purchase that was actually paid.
 * Everything else goes against what you still owe the supplier.
 */
export function maxCashRefund(b: PurchaseBundle, value: number) {
  const paidNet = Number(b.purchase.paid) - b.cashRefunded;
  const newEffective = Number(b.purchase.total) - b.returnedValue - value;
  return round2(Math.min(Math.max(paidNet - newEffective, 0), value));
}

/**
 * Send items back to a supplier. Stock goes down; the value is split into money the supplier pays back
 * (cash) and the rest, which lowers what you owe them (credit).
 */
export async function createPurchaseReturn(a: {
  purchaseId: string; lines: { itemId: string; qty: number }[]; cash: number; accountId: string | null; note: string;
}): Promise<PurchaseReturn> {
  const now = new Date().toISOString();
  let result!: PurchaseReturn;
  await db.transaction('rw', db.tables, async () => {
    const b = await loadPurchase(a.purchaseId);
    if (!b) throw new Error('Purchase not found.');
    const picked = a.lines.filter((l) => l.qty > 0).map((l) => {
      const it = b.items.find((x) => x.id === l.itemId);
      if (!it) throw new Error('Item not on this purchase.');
      const left = Number(it.qty) - (b.returnedQty[it.id] ?? 0);
      if (l.qty > left + 1e-9) throw new Error(`Only ${left} of “${it.name}” can still be sent back.`);
      return { it, qty: l.qty, refund: round2(unitCostPaid(it) * l.qty) };
    });
    if (!picked.length) throw new Error('Choose at least one item to send back.');
    const value = round2(picked.reduce((s, p) => s + p.refund, 0));
    const maxCash = maxCashRefund(b, value);
    const cash = round2(a.cash);
    if (cash < 0 || cash > maxCash + 0.005) throw new Error(`The supplier can pay back at most ${maxCash}.`);
    const credit = round2(value - cash);
    if (credit > 0 && !b.purchase.party_id) throw new Error('This purchase has no supplier, so the whole amount must come back as money.');
    if (cash > 0 && !a.accountId) throw new Error('Choose the account the money is paid into.');

    const id = uid();
    const no = await nextNo('purchaseReturnSeq', 'PR-');
    result = (await putRow('purchase_returns', {
      id, return_no: no, purchase_id: b.purchase.id, party_id: b.purchase.party_id, total: value,
      cash_refund: cash, credit_adjust: credit, account_id: cash > 0 ? a.accountId : null,
      note: a.note.trim() || null, created_at: now, deleted_at: null,
    })) as PurchaseReturn;
    for (const p of picked) {
      await putRow('purchase_return_items', {
        id: uid(), return_id: id, purchase_item_id: p.it.id, product_id: p.it.product_id, name: p.it.name,
        qty: p.qty, unit_cost: Number(p.it.unit_cost), refund: p.refund,
      });
      await moveStock(p.it.product_id, -p.qty, 'purchase_return', id);
    }
    if (cash > 0) {
      await putRow('transactions', {
        id: uid(), account_id: a.accountId, direction: 'in', amount: cash, type: 'purchase_refund',
        party_id: b.purchase.party_id, ref_id: id, note: no, created_at: now, deleted_at: null,
      });
    }
  });
  return result;
}

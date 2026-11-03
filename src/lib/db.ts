import Dexie, { type Table } from 'dexie';
import type {
  Account, Employee, EmployeeEntry, Expense, Invoice, InvoiceItem, Party, Product, Purchase, PurchaseItem, PurchaseReturn, PurchaseReturnItem, SaleReturn, SaleReturnItem,
  StockMovement, Transaction,
} from './types';

// Order matters: parents before children (foreign keys on the server).
export const TABLES = [
  'accounts', 'parties', 'products', 'invoices', 'invoice_items',
  'sale_returns', 'sale_return_items', 'purchases', 'purchase_items', 'employees', 'employee_entries', 'purchase_returns', 'purchase_return_items',
  'stock_movements', 'expenses', 'transactions',
] as const;
export type TableName = (typeof TABLES)[number];

export interface OutboxRow { seq?: number; table: TableName; row: Record<string, any> }
export interface MetaRow { key: string; value: any }

class PosDB extends Dexie {
  declare accounts: Table<Account, string>;
  declare parties: Table<Party, string>;
  declare products: Table<Product, string>;
  declare invoices: Table<Invoice, string>;
  declare invoice_items: Table<InvoiceItem, string>;
  declare stock_movements: Table<StockMovement, string>;
  declare expenses: Table<Expense, string>;
  declare transactions: Table<Transaction, string>;
  declare sale_returns: Table<SaleReturn, string>;
  declare sale_return_items: Table<SaleReturnItem, string>;
  declare purchases: Table<Purchase, string>;
  declare purchase_items: Table<PurchaseItem, string>;
  declare employees: Table<Employee, string>;
  declare employee_entries: Table<EmployeeEntry, string>;
  declare purchase_returns: Table<PurchaseReturn, string>;
  declare purchase_return_items: Table<PurchaseReturnItem, string>;
  declare outbox: Table<OutboxRow, number>;
  declare meta: Table<MetaRow, string>;

  constructor() {
    super('horeca-pos');
    this.version(1).stores({
      accounts: 'id, kind',
      parties: 'id, name, phone, type',
      products: 'id, barcode, name',
      invoices: 'id, invoice_no, created_at',
      invoice_items: 'id, invoice_id',
      stock_movements: 'id, product_id',
      expenses: 'id, spent_at',
      transactions: 'id, account_id, created_at',
      outbox: '++seq',
      meta: 'key',
    });
    // v2 adds returns, purchases and a ref_id index. Existing data is kept as it is.
    this.version(2).stores({
      transactions: 'id, account_id, created_at, ref_id',
      sale_returns: 'id, return_no, invoice_id, created_at',
      sale_return_items: 'id, return_id, invoice_item_id',
      purchases: 'id, purchase_no, party_id, created_at',
      purchase_items: 'id, purchase_id',
    });
    // v3 adds employees and their salary entries
    this.version(3).stores({
      employees: 'id, name',
      employee_entries: 'id, employee_id, created_at',
    });
    // v4 adds purchase returns
    this.version(4).stores({
      purchase_returns: 'id, return_no, purchase_id, created_at',
      purchase_return_items: 'id, return_id, purchase_item_id',
    });
  }
}

export const db = new PosDB();

/** Save a row locally and queue it for the next sync. */
let lastTs = 0;
export async function putRow(table: TableName, row: Record<string, any>) {
  // strictly increasing timestamps, so rows written one after another keep their order (e.g. invoice lines)
  lastTs = Math.max(Date.now(), lastTs + 1);
  const r = { ...row, updated_at: new Date(lastTs).toISOString() };
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(r);
    await db.outbox.add({ table, row: r });
  });
  return r;
}

/**
 * Record a stock change. Stock is an append-only ledger: the server trigger applies it
 * to products.stock_qty. Locally we update the cached quantity right away, without
 * queuing the product row (so a sync never overwrites the server's stock figure).
 */
export async function moveStock(
  product_id: string, qty_change: number,
  reason: 'sale' | 'purchase' | 'adjustment' | 'opening' | 'return' | 'cancel' | 'purchase_return', ref_id?: string,
) {
  const now = new Date().toISOString();
  await putRow('stock_movements', {
    id: crypto.randomUUID(), product_id, qty_change, reason,
    ref_id: ref_id ?? null, created_at: now,
  });
  await db.products.where('id').equals(product_id).modify((p) => {
    p.stock_qty = Number(p.stock_qty) + qty_change;
  });
}

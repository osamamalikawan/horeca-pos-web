export type Kind = 'cash' | 'bank' | 'easypaisa' | 'jazzcash';

export interface Product {
  id: string; barcode: string | null; name: string; category: string | null;
  cost_price: number; sale_price: number; stock_qty: number; low_stock_alert: number;
  supplier_id?: string | null; short_code?: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface Party {
  id: string; name: string; phone: string | null; type: 'customer' | 'supplier';
  created_at: string; updated_at: string; deleted_at: string | null;
  address?: string | null; company?: string | null; is_business?: boolean;
  credit_limit?: number; opening_balance?: number;
}
export interface Account {
  id: string; name: string; kind: Kind; opening_balance: number;
  created_at: string; updated_at: string;
}
export interface Invoice {
  id: string; invoice_no: string; party_id: string | null;
  subtotal: number; item_discount_total: number; bill_discount: number;
  discount_total: number; total: number; paid: number; account_id: string | null;
  item_count: number; created_at: string; updated_at: string; deleted_at: string | null;
  cancelled_at?: string | null; cancel_reason?: string | null;
  created_by?: string | null; created_by_name?: string | null;
}
export interface InvoiceItem {
  id: string; invoice_id: string; product_id: string; name: string;
  qty: number; unit_price: number; discount: number; line_total: number; updated_at: string;
}
export interface StockMovement {
  id: string; product_id: string; qty_change: number;
  reason: 'sale' | 'purchase' | 'adjustment' | 'opening' | 'return' | 'cancel' | 'purchase_return'; ref_id: string | null;
  created_at: string; updated_at: string;
}
export interface Expense {
  id: string; category: string; note: string | null; amount: number; account_id: string;
  spent_at: string; created_at: string; updated_at: string; deleted_at: string | null;
}
export interface Transaction {
  id: string; account_id: string; direction: 'in' | 'out'; amount: number;
  type: 'sale' | 'expense' | 'receipt' | 'payment' | 'purchase' | 'refund' | 'salary' | 'advance' | 'purchase_refund'; party_id: string | null;
  ref_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

export interface SaleReturn {
  id: string; return_no: string; invoice_id: string; party_id: string | null;
  total: number; cash_refund: number; credit_adjust: number; account_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface SaleReturnItem {
  id: string; return_id: string; invoice_item_id: string; product_id: string; name: string;
  qty: number; unit_price: number; refund: number; updated_at: string;
}
export interface Purchase {
  id: string; purchase_no: string; party_id: string | null; bill_no: string | null;
  subtotal: number; total: number; paid: number; account_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
  cancelled_at?: string | null; cancel_reason?: string | null;
}
export interface PurchaseItem {
  id: string; purchase_id: string; product_id: string; name: string;
  qty: number; unit_cost: number; line_total: number; updated_at: string;
}

export interface Employee {
  id: string; name: string; phone: string | null; designation: string | null; address: string | null;
  monthly_salary: number; joined_on: string | null; opening_balance: number; active: boolean;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export type EmployeeEntryKind = 'salary' | 'bonus' | 'deduction' | 'advance' | 'payment';
export interface EmployeeEntry {
  id: string; employee_id: string; kind: EmployeeEntryKind; amount: number; month: string | null;
  account_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

export interface PurchaseReturn {
  id: string; return_no: string; purchase_id: string; party_id: string | null;
  total: number; cash_refund: number; credit_adjust: number; account_id: string | null; note: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}
export interface PurchaseReturnItem {
  id: string; return_id: string; purchase_item_id: string; product_id: string; name: string;
  qty: number; unit_cost: number; refund: number; updated_at: string;
}

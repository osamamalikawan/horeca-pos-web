export interface NavItem { href: string; label: string; hint: string }
export interface NavGroup { label: string; items: NavItem[] }

/** Main menu. A group with one page is shown as a plain link. */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'POS', items: [{ href: '/', label: 'POS', hint: 'Make a sale' }] },
  { label: 'Selling', items: [
    { href: '/sales/', label: 'Sales', hint: 'Past invoices, reprint, cancel' },
    { href: '/returns/', label: 'Returns', hint: 'Take items back from an invoice' },
  ] },
  { label: 'Stock', items: [
    { href: '/products/', label: 'Products', hint: 'Items, prices, barcodes, stock' },
    { href: '/purchases/', label: 'Purchases', hint: 'Restock from a supplier' },
    { href: '/purchase-returns/', label: 'Purchase returns', hint: 'Send items back to a supplier' },
    { href: '/suppliers/', label: 'Suppliers', hint: 'Who you buy from, what you owe' },
  ] },
  { label: 'People', items: [
    { href: '/customers/', label: 'Customers', hint: 'Retail and B2B customers' },
    { href: '/employees/', label: 'Employees', hint: 'Salary, advances, payments' },
  ] },
  { label: 'Money', items: [
    { href: '/expenses/', label: 'Expenses', hint: 'Rent, bills, running costs' },
    { href: '/payments/', label: 'Payments', hint: 'Receive and pay money' },
    { href: '/accounts/', label: 'Accounts', hint: 'Cash, bank, Easypaisa, JazzCash' },
    { href: '/ledgers/', label: 'Ledgers', hint: 'Customer, supplier, employee statements' },
  ] },
];

/** Shown in the user menu, top right. */
export const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/settings/', label: 'Settings', hint: 'Printers, scanner, shop details' },
  { href: '/users/', label: 'Users', hint: 'Who can sign in, and what they can do' },
];

export const sameRoute = (a: string, b: string) => (a.length > 1 ? a.replace(/\/$/, '') : a) === (b.length > 1 ? b.replace(/\/$/, '') : b);

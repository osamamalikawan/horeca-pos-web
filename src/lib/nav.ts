export interface NavItem { href: string; label: string; hint: string; key?: string }   // key: shortcut, e.g. 'Alt+S'
export interface NavGroup { label: string; items: NavItem[] }

/** Main menu. A group with one page is shown as a plain link. */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'POS', items: [{ href: '/', key: 'Alt+P', label: 'POS', hint: 'Make a sale' }] },
  { label: 'Selling', items: [
    { href: '/sales/', key: 'Alt+S', label: 'Sales', hint: 'Past invoices, reprint, cancel' },
    { href: '/returns/', key: 'Alt+R', label: 'Returns', hint: 'Take items back from an invoice' },
  ] },
  { label: 'Stock', items: [
    { href: '/products/', key: 'Alt+I', label: 'Products', hint: 'Items, prices, barcodes, stock' },
    { href: '/purchases/', key: 'Alt+U', label: 'Purchases', hint: 'Restock from a supplier' },
    { href: '/purchase-returns/', key: 'Alt+Shift+P', label: 'Purchase returns', hint: 'Send items back to a supplier' },
    { href: '/suppliers/', key: 'Alt+V', label: 'Suppliers', hint: 'Who you buy from, what you owe' },
  ] },
  { label: 'People', items: [
    { href: '/customers/', key: 'Alt+C', label: 'Customers', hint: 'Retail and B2B customers' },
    { href: '/employees/', key: 'Alt+M', label: 'Employees', hint: 'Salary, advances, payments' },
  ] },
  { label: 'Money', items: [
    { href: '/expenses/', key: 'Alt+X', label: 'Expenses', hint: 'Rent, bills, running costs' },
    { href: '/payments/', key: 'Alt+Y', label: 'Payments', hint: 'Receive and pay money' },
    { href: '/accounts/', key: 'Alt+A', label: 'Accounts', hint: 'Cash, bank, Easypaisa, JazzCash' },
    { href: '/ledgers/', key: 'Alt+G', label: 'Ledgers', hint: 'Customer, supplier, employee statements' },
  ] },
];

/** Shown in the user menu, top right. */
export const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/settings/', key: 'Alt+T', label: 'Settings', hint: 'Printers, scanner, shop details' },
  { href: '/users/', key: 'Alt+Shift+U', label: 'Users', hint: 'Who can sign in, and what they can do' },
];

export const sameRoute = (a: string, b: string) => (a.length > 1 ? a.replace(/\/$/, '') : a) === (b.length > 1 ? b.replace(/\/$/, '') : b);

export interface ModuleDef { key: string; label: string; actions: { key: string; label: string }[] }

// permission string = "<module>.<action>", e.g. "pos.edit"
export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', actions: [{ key: 'view', label: 'Open' }] },
  { key: 'pos', label: 'POS', actions: [
    { key: 'view', label: 'Open' }, { key: 'edit', label: 'Make sales' },
    { key: 'discount', label: 'Give discounts' }, { key: 'price', label: 'Change prices' } ] },
  { key: 'sales', label: 'Sales', actions: [{ key: 'view', label: 'Open' }, { key: 'cancel', label: 'Cancel sales' }] },
  { key: 'returns', label: 'Returns', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Make returns' }] },
  { key: 'products', label: 'Products', actions: [
    { key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' } ] },
  { key: 'purchases', label: 'Purchases', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }, { key: 'cancel', label: 'Cancel purchases' }] },
  { key: 'suppliers', label: 'Suppliers', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'customers', label: 'Customers', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'employees', label: 'Employees', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add, edit and pay' }] },
  { key: 'expenses', label: 'Expenses', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'payments', label: 'Payments', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Receive and pay' }] },
  { key: 'accounts', label: 'Accounts', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Edit opening balances' }] },
  { key: 'ledgers', label: 'Ledgers', actions: [{ key: 'view', label: 'Open' }] },
  { key: 'settings', label: 'Settings', actions: [{ key: 'view', label: 'Open' }] },
];

/**
 * Field-level access to two product values, set per user as Hidden / View only / Edit:
 *   products.cost = can see the cost price,  products.cost_edit = can also change it   (same for stock)
 * They do not need the Products page: a cashier can see stock on the POS without opening Products.
 */
export type Level = 'hide' | 'view' | 'edit';
export type FieldKey = 'cost' | 'stock';
export const FIELDS: { key: FieldKey; label: string; note: string }[] = [
  { key: 'cost', label: 'Cost price', note: 'Shown on Products and as the starting cost when buying' },
  { key: 'stock', label: 'Stock on hand', note: 'Shown on Products, the POS and Purchases' },
];
export const FIELD_PERMS = FIELDS.flatMap((f) => [`products.${f.key}`, `products.${f.key}_edit`]);
export const levelOf = (perms: string[], f: FieldKey): Level =>
  perms.includes(`products.${f}_edit`) ? 'edit' : perms.includes(`products.${f}`) ? 'view' : 'hide';
export const withLevel = (perms: string[], f: FieldKey, level: Level) => {
  const rest = perms.filter((p) => p !== `products.${f}` && p !== `products.${f}_edit`);
  return level === 'edit' ? [...rest, `products.${f}`, `products.${f}_edit`] : level === 'view' ? [...rest, `products.${f}`] : rest;
};
/** What the signed-in user may do with a field. Administrators can always edit. */
export const fieldLevel = (can: (p: string) => boolean, f: FieldKey): Level =>
  can(`products.${f}_edit`) ? 'edit' : can(`products.${f}`) ? 'view' : 'hide';

export const ALL_PERMS = [...MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}`)), ...FIELD_PERMS];

/** Any action on a module needs the module to be openable. */
export function withViews(perms: string[]): string[] {
  const set = new Set(perms.filter((p) => ALL_PERMS.includes(p)));
  FIELDS.forEach((f) => { if (set.has(`products.${f.key}_edit`)) set.add(`products.${f.key}`); });   // edit includes view
  set.forEach((p) => { const [m, a] = p.split('.'); if (a !== 'view' && !FIELD_PERMS.includes(p)) set.add(`${m}.view`); });
  return ALL_PERMS.filter((p) => set.has(p));
}

export const PRESETS: Record<string, string[]> = {
  Cashier: ['pos.view', 'pos.edit', 'products.stock', 'sales.view', 'returns.view', 'customers.view', 'customers.edit'],
  Manager: ALL_PERMS.filter((p) => !p.startsWith('settings.') && !p.startsWith('accounts.edit') && p !== 'employees.edit'),
  Accountant: ['dashboard.view', 'accounts.view', 'accounts.edit', 'expenses.view', 'expenses.edit', 'payments.view', 'payments.edit',
    'ledgers.view', 'sales.view', 'purchases.view', 'suppliers.view', 'customers.view', 'employees.view'],
};

// page -> permission needed to open it. 'admin' means administrators only.
export const ROUTE_PERM: Record<string, string> = {
  '/': 'dashboard.view', '/pos': 'pos.view', '/sales': 'sales.view', '/returns': 'returns.view', '/products': 'products.view',
  '/purchases': 'purchases.view', '/purchase-returns': 'purchases.view', '/suppliers': 'suppliers.view', '/customers': 'customers.view',
  '/employees': 'employees.view', '/expenses': 'expenses.view', '/payments': 'payments.view',
  '/accounts': 'accounts.view', '/ledgers': 'ledgers.view', '/settings': 'settings.view', '/users': 'admin',
};
export const permForPath = (path: string) => ROUTE_PERM[path.length > 1 ? path.replace(/\/$/, '') : path];

export interface Profile {
  id: string; email: string | null; name: string; role: 'admin' | 'staff'; permissions: string[]; active: boolean;
}

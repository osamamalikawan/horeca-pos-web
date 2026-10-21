export interface ModuleDef { key: string; label: string; actions: { key: string; label: string }[] }

// permission string = "<module>.<action>", e.g. "pos.edit"
export const MODULES: ModuleDef[] = [
  { key: 'pos', label: 'POS', actions: [
    { key: 'view', label: 'Open' }, { key: 'edit', label: 'Make sales' },
    { key: 'discount', label: 'Give discounts' }, { key: 'price', label: 'Change prices' } ] },
  { key: 'sales', label: 'Sales', actions: [{ key: 'view', label: 'Open' }, { key: 'cancel', label: 'Cancel sales' }] },
  { key: 'returns', label: 'Returns', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Make returns' }] },
  { key: 'products', label: 'Products', actions: [
    { key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }, { key: 'cost', label: 'See cost prices' } ] },
  { key: 'purchases', label: 'Purchases', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'suppliers', label: 'Suppliers', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'customers', label: 'Customers', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'employees', label: 'Employees', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add, edit and pay' }] },
  { key: 'expenses', label: 'Expenses', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Add and edit' }] },
  { key: 'payments', label: 'Payments', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Receive and pay' }] },
  { key: 'accounts', label: 'Accounts', actions: [{ key: 'view', label: 'Open' }, { key: 'edit', label: 'Edit opening balances' }] },
  { key: 'ledgers', label: 'Ledgers', actions: [{ key: 'view', label: 'Open' }] },
  { key: 'settings', label: 'Settings', actions: [{ key: 'view', label: 'Open' }] },
];

export const ALL_PERMS = MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}`));

/** Any action on a module needs the module to be openable. */
export function withViews(perms: string[]): string[] {
  const set = new Set(perms.filter((p) => ALL_PERMS.includes(p)));
  set.forEach((p) => { const [m, a] = p.split('.'); if (a !== 'view') set.add(`${m}.view`); });
  return ALL_PERMS.filter((p) => set.has(p));
}

export const PRESETS: Record<string, string[]> = {
  Cashier: ['pos.view', 'pos.edit', 'sales.view', 'returns.view', 'customers.view', 'customers.edit'],
  Manager: ALL_PERMS.filter((p) => !p.startsWith('settings.') && !p.startsWith('accounts.edit') && p !== 'employees.edit'),
  Accountant: ['accounts.view', 'accounts.edit', 'expenses.view', 'expenses.edit', 'payments.view', 'payments.edit',
    'ledgers.view', 'sales.view', 'purchases.view', 'suppliers.view', 'customers.view', 'employees.view'],
};

// page -> permission needed to open it. 'admin' means administrators only.
export const ROUTE_PERM: Record<string, string> = {
  '/': 'pos.view', '/sales': 'sales.view', '/returns': 'returns.view', '/products': 'products.view',
  '/purchases': 'purchases.view', '/suppliers': 'suppliers.view', '/customers': 'customers.view',
  '/employees': 'employees.view', '/expenses': 'expenses.view', '/payments': 'payments.view',
  '/accounts': 'accounts.view', '/ledgers': 'ledgers.view', '/settings': 'settings.view', '/users': 'admin',
};
export const permForPath = (path: string) => ROUTE_PERM[path.length > 1 ? path.replace(/\/$/, '') : path];

export interface Profile {
  id: string; email: string | null; name: string; role: 'admin' | 'staff'; permissions: string[]; active: boolean;
}

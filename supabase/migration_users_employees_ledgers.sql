-- Horeca POS: customers (B2B), employees, users with custom access, ledgers.
-- Run once in the Supabase SQL editor, after schema.sql and migration_sales_returns_purchases.sql.
-- Safe to run again.
--
-- IMPORTANT: this also replaces the "any signed-in user can do anything" rule with per-user access.
-- Every login that already exists becomes an admin, so nobody is locked out. Create other users
-- from the Users page (needs the admin-users function, see supabase/functions/admin-users).

begin;

-- 1. fuller customer and supplier details
alter table parties
  add column if not exists address text,
  add column if not exists company text,
  add column if not exists is_business boolean not null default false,
  add column if not exists credit_limit numeric(14,2) not null default 0,
  add column if not exists opening_balance numeric(14,2) not null default 0;  -- owed to us (customer) or by us (supplier) before the POS

-- 2. who made each sale
alter table invoices
  add column if not exists created_by uuid,
  add column if not exists created_by_name text;

-- 3. salary money movements
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('sale','expense','receipt','payment','purchase','refund','salary','advance'));

-- 4. employees
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  designation text,
  address text,
  monthly_salary numeric(14,2) not null default 0,
  joined_on date,
  opening_balance numeric(14,2) not null default 0,   -- owed to the employee before the POS (negative: employee owes us)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- salary and bonus raise what we owe; deduction, advance and payment lower it
create table if not exists employee_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  kind text not null check (kind in ('salary','bonus','deduction','advance','payment')),
  amount numeric(14,2) not null check (amount > 0),
  month text,                                          -- 'YYYY-MM' for salary
  account_id uuid references accounts(id),             -- set when money moved (advance, payment)
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

do $$ declare t text; begin
  foreach t in array array['employees','employee_entries'] loop
    execute format('drop trigger if exists trg_%I_upd on %I', t, t);
    execute format('create trigger trg_%I_upd before update on %I for each row execute function set_updated_at()', t, t);
    execute format('create index if not exists idx_%I_upd on %I(updated_at)', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 5. users: one profile per login, with a list of permissions
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'staff' check (role in ('admin','staff')),
  permissions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_upd on profiles;
create trigger trg_profiles_upd before update on profiles for each row execute function set_updated_at();
alter table profiles enable row level security;

-- everyone who can already sign in becomes an admin
insert into profiles (id, email, name, role)
select id, email, coalesce(split_part(email, '@', 1), ''), 'admin' from auth.users
on conflict (id) do nothing;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$$;
create or replace function is_active_user() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;
create or replace function has_any_perm(perms text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and (role = 'admin' or permissions && perms));
$$;

drop policy if exists "read own or admin" on profiles;
drop policy if exists "admin writes" on profiles;
create policy "read own or admin" on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy "admin writes" on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- sales may lower stock for products the cashier cannot edit
create or replace function apply_stock_movement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update products set stock_qty = stock_qty + new.qty_change, updated_at = now() where id = new.product_id;
  return new;
end; $$;

-- 6. per-table access. read_perms null = any active user. Admins pass every check.
do $$ declare r record; begin
  for r in select * from (values
    ('accounts',          null::text[], array['accounts.edit']),
    ('parties',           null,         array['pos.edit','customers.edit','suppliers.edit','purchases.edit','payments.edit']),
    ('products',          null,         array['products.edit','purchases.edit']),
    ('stock_movements',   null,         array['pos.edit','sales.cancel','returns.edit','purchases.edit','products.edit']),
    ('invoices',          array['pos.view','sales.view','returns.view','accounts.view','payments.view','ledgers.view','customers.view'], array['pos.edit','sales.cancel']),
    ('invoice_items',     array['pos.view','sales.view','returns.view','accounts.view','payments.view','ledgers.view','customers.view'], array['pos.edit','sales.cancel']),
    ('sale_returns',      array['returns.view','sales.view','accounts.view','payments.view','ledgers.view','customers.view'], array['returns.edit']),
    ('sale_return_items', array['returns.view','sales.view','accounts.view','payments.view','ledgers.view','customers.view'], array['returns.edit']),
    ('purchases',         array['purchases.view','suppliers.view','accounts.view','payments.view','ledgers.view'], array['purchases.edit']),
    ('purchase_items',    array['purchases.view','suppliers.view','accounts.view','payments.view','ledgers.view'], array['purchases.edit']),
    ('expenses',          array['expenses.view','accounts.view'], array['expenses.edit']),
    ('transactions',      array['pos.view','sales.view','returns.view','purchases.view','suppliers.view','customers.view','expenses.view','payments.view','accounts.view','ledgers.view','employees.view'],
                          array['pos.edit','sales.cancel','returns.edit','purchases.edit','expenses.edit','payments.edit','suppliers.edit','customers.edit','employees.edit']),
    ('employees',         array['employees.view','ledgers.view'], array['employees.edit']),
    ('employee_entries',  array['employees.view','ledgers.view'], array['employees.edit'])
  ) as v(tbl, read_perms, write_perms) loop
    execute format('drop policy if exists "auth full access" on %I', r.tbl);
    execute format('drop policy if exists "perm read" on %I', r.tbl);
    execute format('drop policy if exists "perm insert" on %I', r.tbl);
    execute format('drop policy if exists "perm update" on %I', r.tbl);
    execute format('drop policy if exists "perm delete" on %I', r.tbl);
    execute format('create policy "perm read" on %I for select to authenticated using (%s)', r.tbl,
      case when r.read_perms is null then 'is_active_user()' else format('has_any_perm(%L)', r.read_perms) end);
    execute format('create policy "perm insert" on %I for insert to authenticated with check (has_any_perm(%L))', r.tbl, r.write_perms);
    execute format('create policy "perm update" on %I for update to authenticated using (has_any_perm(%L)) with check (has_any_perm(%L))', r.tbl, r.write_perms, r.write_perms);
    execute format('create policy "perm delete" on %I for delete to authenticated using (has_any_perm(%L))', r.tbl, r.write_perms);
  end loop;
end $$;

-- only users with the "cancel sales" permission can cancel (or un-cancel) an invoice
create or replace function guard_invoice_cancel() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled_at is distinct from old.cancelled_at and not has_any_perm(array['sales.cancel']) then
    raise exception 'You do not have permission to cancel sales';
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_guard_cancel on invoices;
create trigger trg_invoices_guard_cancel before update on invoices for each row execute function guard_invoice_cancel();

-- the subscription switch (if created) stays readable by active users
do $$ begin
  if to_regclass('public.subscription') is not null then
    drop policy if exists "read subscription" on subscription;
    create policy "read subscription" on subscription for select to authenticated using (is_active_user());
  end if;
end $$;

commit;

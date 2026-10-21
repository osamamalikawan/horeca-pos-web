-- Horeca Store POS — Supabase schema (v1)
-- Every table: uuid PK generated on the client (works offline), updated_at for sync, deleted_at for soft delete.

create extension if not exists "pgcrypto";

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

-- PRODUCTS
create table products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  category text,
  cost_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  stock_qty numeric(12,3) not null default 0,   -- maintained by trigger from stock_movements
  low_stock_alert numeric(12,3) default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- CUSTOMERS / SUPPLIERS
create table parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  type text not null check (type in ('customer','supplier')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ACCOUNTS (cash, bank, easypaisa, jazzcash)
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null unique check (kind in ('cash','bank','easypaisa','jazzcash')),
  opening_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into accounts (name, kind) values
  ('Cash','cash'),('Bank','bank'),('Easypaisa','easypaisa'),('JazzCash','jazzcash');

-- INVOICES
create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,               -- e.g. DEVICE-000123, generated per device to avoid clashes offline
  party_id uuid references parties(id),
  subtotal numeric(14,2) not null default 0,     -- sum of qty * unit_price
  item_discount_total numeric(14,2) not null default 0,
  bill_discount numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0, -- item + bill discounts (shown on invoice)
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  account_id uuid references accounts(id),       -- how it was paid
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  product_id uuid not null references products(id),
  name text not null,                            -- snapshot
  qty numeric(12,3) not null,
  unit_price numeric(12,2) not null,
  discount numeric(12,2) not null default 0,     -- per-line discount (amount)
  line_total numeric(14,2) not null,
  updated_at timestamptz not null default now()
);

-- STOCK LEDGER (append-only: safe for multi-device offline sync)
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  qty_change numeric(12,3) not null,             -- negative for sales
  reason text not null check (reason in ('sale','purchase','adjustment','opening')),
  ref_id uuid,                                   -- invoice id etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function apply_stock_movement() returns trigger as $$
begin
  update products set stock_qty = stock_qty + new.qty_change, updated_at = now()
  where id = new.product_id;
  return new;
end; $$ language plpgsql;
create trigger trg_stock after insert on stock_movements
  for each row execute function apply_stock_movement();

-- EXPENSES
create table expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  note text,
  amount numeric(14,2) not null check (amount > 0),
  account_id uuid not null references accounts(id),
  spent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- MONEY LEDGER: every in/out of any account. Account balances = opening + sum(in) - sum(out)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  type text not null check (type in ('sale','expense','receipt','payment')),
  party_id uuid references parties(id),
  ref_id uuid,                                   -- invoice / expense id
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Account summary for the Accounts page
create view account_balances as
select a.id, a.name, a.kind,
  a.opening_balance
  + coalesce(sum(case when t.direction='in'  then t.amount end),0)
  - coalesce(sum(case when t.direction='out' then t.amount end),0) as balance
from accounts a
left join transactions t on t.account_id = a.id and t.deleted_at is null
group by a.id;

-- updated_at triggers + sync indexes
do $$ declare t text; begin
  foreach t in array array['products','parties','accounts','invoices','invoice_items',
                           'stock_movements','expenses','transactions'] loop
    execute format('create trigger trg_%I_upd before update on %I for each row execute function set_updated_at()', t, t);
    execute format('create index idx_%I_upd on %I(updated_at)', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy "auth full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

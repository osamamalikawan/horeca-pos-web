-- Horeca POS: sales cancel, returns, suppliers and purchases.
-- Run once in the Supabase SQL editor BEFORE using the new pages. Safe to run again.

begin;

-- cancelled sales
alter table invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

-- new kinds of stock movement and money movement
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale','purchase','adjustment','opening','return','cancel'));

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('sale','expense','receipt','payment','purchase','refund'));

-- sales returns
create table if not exists sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  invoice_id uuid not null references invoices(id),
  party_id uuid references parties(id),
  total numeric(14,2) not null default 0,          -- value of the returned items
  cash_refund numeric(14,2) not null default 0,    -- money paid back
  credit_adjust numeric(14,2) not null default 0,  -- taken off what the customer owes
  account_id uuid references accounts(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references sale_returns(id) on delete cascade,
  invoice_item_id uuid not null references invoice_items(id),
  product_id uuid not null references products(id),
  name text not null,
  qty numeric(12,3) not null,
  unit_price numeric(12,2) not null,
  refund numeric(14,2) not null,
  updated_at timestamptz not null default now()
);

-- purchases (restock). The supplier is a row in parties with type 'supplier'.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  party_id uuid references parties(id),
  bill_no text,
  subtotal numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  account_id uuid references accounts(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid not null references products(id),
  name text not null,
  qty numeric(12,3) not null,
  unit_cost numeric(12,2) not null,
  line_total numeric(14,2) not null,
  updated_at timestamptz not null default now()
);

-- sync support for the new tables: updated_at trigger, index, row level security
do $$ declare t text; begin
  foreach t in array array['sale_returns','sale_return_items','purchases','purchase_items'] loop
    execute format('drop trigger if exists trg_%I_upd on %I', t, t);
    execute format('create trigger trg_%I_upd before update on %I for each row execute function set_updated_at()', t, t);
    execute format('create index if not exists idx_%I_upd on %I(updated_at)', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth full access" on %I', t);
    execute format('create policy "auth full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

commit;

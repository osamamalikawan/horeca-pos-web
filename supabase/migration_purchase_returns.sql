-- Horeca POS: purchase returns (items sent back to a supplier).
-- Run once in the Supabase SQL editor, after the earlier SQL files. Safe to run again.

begin;

-- new kinds of stock change and money movement
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale','purchase','adjustment','opening','return','cancel','purchase_return'));

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('sale','expense','receipt','payment','purchase','refund','salary','advance','purchase_refund'));

create table if not exists purchase_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  purchase_id uuid not null references purchases(id),
  party_id uuid references parties(id),
  total numeric(14,2) not null default 0,          -- value of the items sent back
  cash_refund numeric(14,2) not null default 0,    -- money the supplier paid back
  credit_adjust numeric(14,2) not null default 0,  -- taken off what we owe the supplier
  account_id uuid references accounts(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references purchase_returns(id) on delete cascade,
  purchase_item_id uuid not null references purchase_items(id),
  product_id uuid not null references products(id),
  name text not null,
  qty numeric(12,3) not null,
  unit_cost numeric(12,2) not null,
  refund numeric(14,2) not null,
  updated_at timestamptz not null default now()
);

-- sync support and access rules, like the other tables
do $$ declare t text; begin
  foreach t in array array['purchase_returns','purchase_return_items'] loop
    execute format('drop trigger if exists trg_%I_upd on %I', t, t);
    execute format('create trigger trg_%I_upd before update on %I for each row execute function set_updated_at()', t, t);
    execute format('create index if not exists idx_%I_upd on %I(updated_at)', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth full access" on %I', t);
    execute format('drop policy if exists "perm read" on %I', t);
    execute format('drop policy if exists "perm insert" on %I', t);
    execute format('drop policy if exists "perm update" on %I', t);
    execute format('drop policy if exists "perm delete" on %I', t);
    if to_regprocedure('public.has_any_perm(text[])') is not null then
      -- per-user access is set up: same rules as purchases
      execute format('create policy "perm read" on %I for select to authenticated using (has_any_perm(%L))', t,
        array['purchases.view','suppliers.view','accounts.view','payments.view','ledgers.view']);
      execute format('create policy "perm insert" on %I for insert to authenticated with check (has_any_perm(%L))', t, array['purchases.edit']);
      execute format('create policy "perm update" on %I for update to authenticated using (has_any_perm(%L)) with check (has_any_perm(%L))', t, array['purchases.edit'], array['purchases.edit']);
      execute format('create policy "perm delete" on %I for delete to authenticated using (has_any_perm(%L))', t, array['purchases.edit']);
    else
      execute format('create policy "auth full access" on %I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

commit;

-- Horeca POS: product supplier + short code, and per-user Hidden / View only / Edit for cost price and stock on hand.
-- Run once in the Supabase SQL editor (after the earlier SQL files).

alter table products
  add column if not exists supplier_id uuid,      -- the supplier's id in parties (no foreign key, so offline sync order never matters)
  add column if not exists short_code text;
create index if not exists products_short_code_idx on products (lower(short_code));

-- Keep today's access for existing staff, the first time only (the guard trigger below marks that it has run):
--   everyone keeps seeing stock; people who could add/edit products keep editing stock; people who saw and edited cost keep editing it.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_products_guard_fields') then
    update profiles set permissions = array(select distinct unnest(
      permissions
      || array['products.stock']
      || case when 'products.edit' = any(permissions) then array['products.stock_edit'] else '{}'::text[] end
      || case when 'products.cost' = any(permissions) and 'products.edit' = any(permissions) then array['products.cost_edit'] else '{}'::text[] end
    )) where role <> 'admin';
  end if;
end $$;

-- Server-side enforcement of "Edit". (Changes made in the SQL editor, with no signed-in user, are not blocked.)
create or replace function guard_product_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  -- buying stock can update the cost price, so people who make purchases may too
  if new.cost_price is distinct from old.cost_price and not has_any_perm(array['products.cost_edit', 'purchases.edit']) then
    raise exception 'You do not have permission to change cost prices';
  end if;
  return new;
end $$;
drop trigger if exists trg_products_guard_fields on products;
create trigger trg_products_guard_fields before update on products for each row execute function guard_product_fields();

create or replace function guard_stock_changes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.reason in ('adjustment', 'opening') and not has_any_perm(array['products.stock_edit']) then
    raise exception 'You do not have permission to change stock';
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_movements_guard on stock_movements;
create trigger trg_stock_movements_guard before insert on stock_movements for each row execute function guard_stock_changes();

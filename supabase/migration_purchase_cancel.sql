-- Horeca POS: cancel a purchase invoice. Run once in the Supabase SQL editor (after the earlier SQL files).

alter table purchases
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

-- people with the new "Cancel purchases" permission may write the tables a cancel touches
do $$ declare r record; begin
  for r in select * from (values
    ('stock_movements', null::text[], array['pos.edit','sales.cancel','returns.edit','purchases.edit','purchases.cancel','products.edit']),
    ('purchases',       array['purchases.view','suppliers.view','accounts.view','payments.view','ledgers.view'], array['purchases.edit','purchases.cancel']),
    ('purchase_items',  array['purchases.view','suppliers.view','accounts.view','payments.view','ledgers.view'], array['purchases.edit','purchases.cancel']),
    ('transactions',    array['pos.view','sales.view','returns.view','purchases.view','suppliers.view','customers.view','expenses.view','payments.view','accounts.view','ledgers.view','employees.view'],
                        array['pos.edit','sales.cancel','returns.edit','purchases.edit','purchases.cancel','expenses.edit','payments.edit','suppliers.edit','customers.edit','employees.edit'])
  ) as v(tbl, read_perms, write_perms) loop
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

-- only users with the "cancel purchases" permission can cancel (or un-cancel) a purchase
create or replace function guard_purchase_cancel() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled_at is distinct from old.cancelled_at and not has_any_perm(array['purchases.cancel']) then
    raise exception 'You do not have permission to cancel purchases';
  end if;
  return new;
end $$;
drop trigger if exists trg_purchases_guard_cancel on purchases;
create trigger trg_purchases_guard_cancel before update on purchases for each row execute function guard_purchase_cancel();

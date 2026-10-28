-- Horeca POS: back up each login's settings (theme, store details, printers, scanner) in the database,
-- so they come back after a reinstall or on a new computer. Run once in the Supabase SQL editor.
-- Safe to run again. Needs schema.sql to have been run before (it provides set_updated_at).
create table if not exists user_settings (
  id uuid primary key references auth.users(id) on delete cascade,   -- the login this belongs to
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_settings_upd on user_settings;
create trigger trg_user_settings_upd before update on user_settings
  for each row execute function set_updated_at();

alter table user_settings enable row level security;
drop policy if exists "own settings" on user_settings;
create policy "own settings" on user_settings for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

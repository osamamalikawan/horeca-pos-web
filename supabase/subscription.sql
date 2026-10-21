-- Subscription switch (placeholder until the super-admin app exists).
-- The POS reads this after every sync. status 'paused' or 'stopped', or a past valid_until,
-- signs the device out. Only the service role (the future super-admin app) can change it.
create table if not exists subscription (
  id int primary key default 1 check (id = 1),
  status text not null default 'active' check (status in ('active','paused','stopped')),
  valid_until timestamptz,
  message text,
  updated_at timestamptz not null default now()
);
insert into subscription (id) values (1) on conflict do nothing;
alter table subscription enable row level security;
drop policy if exists "read subscription" on subscription;
create policy "read subscription" on subscription for select to authenticated using (true);

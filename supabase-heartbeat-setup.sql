-- Dedicated GitHub heartbeat storage.
-- This table is separate from finance_records and stores no finance data.

create table if not exists public.system_heartbeats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.system_heartbeats enable row level security;

revoke all on table public.system_heartbeats from public;
grant select, insert, update on table public.system_heartbeats to authenticated;

drop policy if exists "heartbeat owner can read" on public.system_heartbeats;
drop policy if exists "heartbeat owner can insert" on public.system_heartbeats;
drop policy if exists "heartbeat owner can update" on public.system_heartbeats;

create policy "heartbeat owner can read"
on public.system_heartbeats
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "heartbeat owner can insert"
on public.system_heartbeats
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "heartbeat owner can update"
on public.system_heartbeats
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

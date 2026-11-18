-- Run in the Supabase SQL Editor. Existing bill and finance rows are untouched.
begin;

create table if not exists public.credit_card_unbilled (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null check (card_id ~ '^[a-z0-9-]{1,64}$'),
  amount numeric not null check (amount >= 0 and amount <= 1.7976931348623157e308),
  updated_at timestamptz not null check (isfinite(updated_at)),
  primary key (user_id, card_id)
);

alter table public.credit_card_unbilled enable row level security;
revoke all on public.credit_card_unbilled from public, anon;
grant select, insert, update, delete on public.credit_card_unbilled to authenticated;

drop policy if exists "manage own unbilled balances" on public.credit_card_unbilled;
create policy "manage own unbilled balances"
on public.credit_card_unbilled for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;

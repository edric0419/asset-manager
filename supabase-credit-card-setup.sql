-- Taiwan credit-card configuration and monthly bill tracking.
-- Run this once in the Supabase SQL Editor before using the credit-card feature.

create table if not exists public.credit_card_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_name text not null default '信用卡',
  country text not null default 'taiwan' check (country = 'taiwan'),
  statement_day smallint not null default 3 check (statement_day between 1 and 28),
  record_day smallint not null default 14 check (record_day between 1 and 28),
  payment_day smallint not null default 18 check (payment_day between 1 and 28),
  payment_asset_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_card_bills (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  country text not null default 'taiwan' check (country = 'taiwan'),
  statement_month text not null check (statement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric not null check (amount >= 0),
  status text not null default 'open' check (status in ('open', 'paid')),
  liability_record_id uuid not null,
  payment_asset_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, statement_month)
);

-- Correct the original escaped regular expression on projects that ran an
-- earlier version of this script. Normal values such as 2026-11 are valid.
alter table public.credit_card_bills
  drop constraint if exists credit_card_bills_statement_month_check;
alter table public.credit_card_bills
  add constraint credit_card_bills_statement_month_check
  check (statement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table public.credit_card_settings enable row level security;
alter table public.credit_card_bills enable row level security;

revoke all on table public.credit_card_settings from public;
revoke all on table public.credit_card_bills from public;
grant select, insert, update on table public.credit_card_settings to authenticated;
grant select, insert, update on table public.credit_card_bills to authenticated;

drop policy if exists "manage own credit card settings" on public.credit_card_settings;
create policy "manage own credit card settings"
on public.credit_card_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "manage own credit card bills" on public.credit_card_bills;
create policy "manage own credit card bills"
on public.credit_card_bills
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

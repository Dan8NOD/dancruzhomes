-- SUPERSEDED by supabase/portal_schema.sql (the $5 one-time flow this table
-- backed was replaced by a $10/mo subscription — see subscriptions table).
-- grader.html no longer reads or writes this table. Left in place rather
-- than dropped in case rows already exist; safe to drop once confirmed
-- empty. Also note: its RLS policy below allows anon to read every row in
-- bulk (every customer's email) — don't reuse this pattern elsewhere.
--
-- ponytail: grader_access table — tracks who paid $5 for full grader access
-- Run this in Supabase SQL editor

create table if not exists grader_access (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  status text not null default 'pending',
  paid_at timestamptz,
  stripe_session_id text,
  amount_paid integer,
  created_at timestamptz default now()
);

-- RLS: allow anon to read paid status (needed for client-side gating)
alter table grader_access enable row level security;

create policy "anon read paid status" on grader_access
  for select to anon
  using (true);

create policy "service role write" on grader_access
  for all to service_role
  using (true)
  with check (true);

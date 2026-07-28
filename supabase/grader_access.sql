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

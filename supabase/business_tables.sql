-- Dan Cruz Homes — business tables for War Room, VA leads, calculator leads, and referrals.
-- Run in Supabase SQL editor (project iubxycckgrplbpdbncfk). Safe to re-run: each block is idempotent.
-- Uses the same RLS patterns as portal_schema.sql and storage_buckets.sql.

-- ── warroom_sessions ── paid negotiation strategy sessions ──────────────────
create table if not exists public.warroom_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  session_type text not null check (session_type in ('seller', 'buyer')),
  phone text,
  address text,
  challenge text,
  paid boolean not null default false,
  scheduled_at timestamptz,
  completed_at timestamptz,
  credited_at_closing boolean not null default false
);
alter table public.warroom_sessions enable row level security;

-- Anyone can book (insert). Only Dan (admin) can read.
drop policy if exists "anyone books warroom session" on public.warroom_sessions;
create policy "anyone books warroom session" on public.warroom_sessions
  for insert to anon, authenticated
  with check (true);

drop policy if exists "admin reads warroom sessions" on public.warroom_sessions;
create policy "admin reads warroom sessions" on public.warroom_sessions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

drop policy if exists "admin updates warroom sessions" on public.warroom_sessions;
create policy "admin updates warroom sessions" on public.warroom_sessions
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- ── va_leads ── VA loan inquiries from the Vet-to-Vet page ───────────────────
create table if not exists public.va_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  phone text,
  zip text,
  market text not null default 'chicagoland',
  is_chicagoland boolean generated always as (
    left(zip, 3) in ('606', '607', '608')
  ) stored,
  one_pager_requested boolean not null default false,
  contacted boolean not null default false,
  referred_to text
);
alter table public.va_leads enable row level security;

drop policy if exists "anyone submits va lead" on public.va_leads;
create policy "anyone submits va lead" on public.va_leads
  for insert to anon, authenticated
  with check (true);

drop policy if exists "admin reads va leads" on public.va_leads;
create policy "admin reads va leads" on public.va_leads
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

drop policy if exists "admin updates va leads" on public.va_leads;
create policy "admin updates va leads" on public.va_leads
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- ── calculator_leads ── seller net proceeds calculator email captures ──────
create table if not exists public.calculator_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  sale_price numeric,
  net_proceeds numeric,
  zip text,
  source text not null default 'calculator'
);
alter table public.calculator_leads enable row level security;

drop policy if exists "anyone submits calculator lead" on public.calculator_leads;
create policy "anyone submits calculator lead" on public.calculator_leads
  for insert to anon, authenticated
  with check (true);

drop policy if exists "admin reads calculator leads" on public.calculator_leads;
create policy "admin reads calculator leads" on public.calculator_leads
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- ── referrals ── agent-to-agent referral tracking ──────────────────────────
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,  -- nullable: may reference va_leads.id or warroom_sessions.id
  lead_source text not null default 'va_leads',
  referred_to_agent text not null,
  referred_to_email text,
  market text,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'closed', 'expired')),
  referral_fee numeric,
  closed_at timestamptz
);
alter table public.referrals enable row level security;

drop policy if exists "admin manages referrals" on public.referrals;
create policy "admin manages referrals" on public.referrals
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin));

-- ── auto-tag VA leads as chicagoland or referral ────────────────────────────
-- ponytail: trigger-based routing, simplest approach for a static site with no server
create or replace function public.route_va_lead()
returns trigger
language plpgsql
security definer
as $$
begin
  -- If outside Chicagoland, create a referral record for tracking
  if not new.is_chicagoland and new.email is not null then
    insert into public.referrals (lead_id, lead_source, market, status)
    values (new.id, 'va_leads', new.market, 'sent');
  end if;
  return new;
end;
$$;

drop trigger if exists va_lead_routing on public.va_leads;
create trigger va_lead_routing
  after insert on public.va_leads
  for each row execute function public.route_va_lead();

grant execute on function public.route_va_lead() to anon, authenticated;

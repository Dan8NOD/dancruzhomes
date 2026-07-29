-- Dan Cruz Homes — Property Portal schema.
-- Run in Supabase SQL editor (project iubxycckgrplbpdbncfk, same one grader.html
-- already talks to). Supersedes grader_access.sql — that table can be dropped
-- once you've confirmed it's empty (`drop table if exists grader_access;`);
-- left in place here untouched since it may already exist in your live DB.
--
-- Fixes vs. the $5 one-time flow this replaces:
--   - grader_access had `for select to anon using (true)` — anyone could read
--     every row (email list of every paying customer, in the clear). Every
--     policy below scopes to auth.uid() or goes through a security-definer
--     function that checks a specific condition — nothing is anon-readable
--     in bulk.
--   - Sharing is NOT "grant anon select on properties" (same leak, table-wide
--     instead of row-wide) — it's a dedicated function that only returns the
--     one row matching an unguessable token you pass in as an argument.

-- ── profiles ── one row per signed-in user; also the admin flag + consent record
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  consented_at timestamptz, -- disclaimer / ConvertKit opt-in timestamp, null = not shown yet
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

create policy "user reads own profile" on profiles for select
  using (auth.uid() = user_id);
create policy "user inserts own profile" on profiles for insert
  with check (auth.uid() = user_id);
create policy "user updates own profile" on profiles for update
  using (auth.uid() = user_id);
-- admin (Dan) needs to see homeowner name/phone/email alongside their properties
create policy "admin reads all profiles" on profiles for select
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.is_admin));

-- Seed Dan as admin. EDIT the email below if the Google account you sign into
-- dancruzhomes.com with isn't dancruzconsultant@gmail.com — this only works
-- after that account's first sign-in (auth.users row must exist), so if it
-- errors with "no rows", sign in once first, then re-run just this statement.
insert into profiles (user_id, is_admin)
select id, true from auth.users where email = 'dancruzconsultant@gmail.com'
on conflict (user_id) do update set is_admin = true;

-- ── subscriptions ── $10/mo portal access (save / share / agent feedback)
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'inactive', -- inactive | active | past_due | canceled
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;

create policy "user reads own subscription" on subscriptions for select
  using (auth.uid() = user_id);
-- writes only ever happen from the Stripe webhook, via the service-role key,
-- which bypasses RLS entirely — no anon/authenticated write policy needed or wanted.

-- ── properties ── one row per property being tracked. This is the save unit —
-- reopening, sharing, and agent visibility all point at a single row per
-- property instead of the old insert-on-every-keystroke snapshot spam.
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  share_token uuid not null default gen_random_uuid(),
  owner_email text, -- denormalized from auth at save time so admin.html can list/contact without querying auth.users
  owner_name text,
  address text,
  state text,
  agent_name text default 'dan cruz',
  score_date date,
  total_score int not null default 0,
  verdict text,
  advice text,
  section_scores jsonb,
  answers jsonb,
  notes text,
  agent_feedback text,
  agent_feedback_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table properties enable row level security;

create policy "owner reads own properties" on properties for select
  using (auth.uid() = owner_user_id);
create policy "owner inserts own properties" on properties for insert
  with check (auth.uid() = owner_user_id);
-- owner can update everything EXCEPT agent_feedback in practice — there's no
-- column-level RLS in Postgres, so this is enforced by the app only ever
-- sending agent_feedback writes through admin_set_feedback() below, never
-- through a direct table update from the homeowner's own client.
create policy "owner updates own properties" on properties for update
  using (auth.uid() = owner_user_id);
create policy "admin reads all properties" on properties for select
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.is_admin));

-- Share-by-link: NOT an anon table policy (that would let anyone list every
-- property via the REST API, token or not — RLS can't scope by "what the
-- client happened to filter on"). Instead, a narrow function that only ever
-- returns the one row matching the exact token argument.
create or replace function get_property_by_share_token(token uuid)
returns setof properties
language sql
security definer
set search_path = public
as $$
  select * from properties where share_token = token;
$$;
grant execute on function get_property_by_share_token(uuid) to anon, authenticated;

-- Admin feedback: a narrow function instead of a direct UPDATE policy, so
-- admin access is provably limited to the two feedback columns and can never
-- accidentally (or via a future bug) overwrite a homeowner's own answers/score.
create or replace function admin_set_feedback(p_id uuid, p_feedback text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  update properties set agent_feedback = p_feedback, agent_feedback_at = now() where id = p_id;
end;
$$;
grant execute on function admin_set_feedback(uuid, text) to authenticated;

-- Dan Cruz Homes — admin read access for lead_submissions.
--
-- lead_submissions previously had only an "owner reads own" SELECT policy
-- (auth.uid() = user_id) — useless for these rows, since anonymous homepage
-- form submits never set user_id. That meant nobody, including Dan, could
-- read lot inquiries or broker-partner applications through the app; the
-- only way to see them was a direct SQL query. Confirmed live via
-- `pg_policies` before writing this (no admin policy existed).
--
-- Mirrors the existing "admin reads all profiles" / "admin reads all
-- properties" pattern in supabase/portal_schema.sql. Backs admin.html's new
-- Leads tab. Run in the Supabase SQL editor (project iubxycckgrplbpdbncfk).
-- Safe to re-run.

drop policy if exists "admin reads all lead_submissions" on lead_submissions;
create policy "admin reads all lead_submissions" on lead_submissions for select
  using (exists (select 1 from profiles p where p.user_id = auth.uid() and p.is_admin));

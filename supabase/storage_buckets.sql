-- Dan Cruz Homes — storage buckets for property listing photos.
-- Run in the Supabase SQL editor (project iubxycckgrplbpdbncfk). Safe to re-run:
-- bucket inserts are upserts and every policy is dropped before it's created.
--
-- Two buckets, both public-read:
--   property-photos     — full-size listing images
--   property-thumbnails — generated/derived small versions
--
-- Follows the RLS patterns already in supabase/portal_schema.sql: the admin
-- check is the same `exists (select 1 from profiles ...)` used by "admin reads
-- all properties" / "admin reads all lead_submissions".
--
-- TWO THINGS TO KNOW BEFORE RUNNING:
--
-- 1. DELETE is admin-only, not authenticated. The spec for this file asked for
--    both "authenticated can INSERT/UPDATE/DELETE" and "only admins can
--    delete" — those can't coexist. Postgres OR's permissive policies together,
--    so shipping both would mean any signed-in user could delete any photo and
--    the admin policy would be decorative. The narrower rule wins below.
--
-- 2. INSERT/UPDATE are open to ANY authenticated user, across the whole bucket.
--    That is what was asked for, but it means any signed-in homeowner can
--    overwrite another homeowner's photos by uploading to their path. If you
--    want the same per-user scoping the properties table has, uncomment the
--    "owner-folder" variants at the bottom and drop the two broad policies.

-- ── buckets ──────────────────────────────────────────────────────────────────
-- public = true means objects are readable at
-- /storage/v1/object/public/<bucket>/<path> without a token. Size/mime limits
-- are enforced by the storage API on upload, so a bad client can't bypass them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos',
  'property-photos',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-thumbnails',
  'property-thumbnails',
  true,
  2097152, -- 2 MB; thumbnails should never approach this
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── RLS on storage.objects ───────────────────────────────────────────────────
-- storage.objects already has RLS enabled by Supabase; this is a no-op that
-- makes the dependency explicit if you ever run this against a fresh project.
alter table storage.objects enable row level security;

-- SELECT — anon and authenticated, both buckets.
-- Note: for a public bucket this policy is NOT what serves the images (the
-- public object route bypasses RLS by design). It's what makes .list() and
-- metadata reads work from the browser with the publishable key.
drop policy if exists "public reads property photos" on storage.objects;
create policy "public reads property photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('property-photos', 'property-thumbnails'));

-- INSERT — any authenticated user. See caveat 2 in the header.
drop policy if exists "authenticated uploads property photos" on storage.objects;
create policy "authenticated uploads property photos" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('property-photos', 'property-thumbnails'));

-- UPDATE — any authenticated user. `using` gates which rows can be targeted,
-- `with check` gates what they can become; both are needed or an update could
-- move an object into a bucket this policy doesn't cover.
drop policy if exists "authenticated updates property photos" on storage.objects;
create policy "authenticated updates property photos" on storage.objects
  for update to authenticated
  using (bucket_id in ('property-photos', 'property-thumbnails'))
  with check (bucket_id in ('property-photos', 'property-thumbnails'));

-- DELETE — admins only. profiles is fully qualified because storage policies
-- are evaluated with storage's search_path, not public's.
drop policy if exists "admin deletes property photos" on storage.objects;
create policy "admin deletes property photos" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('property-photos', 'property-thumbnails')
    and exists (
      select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin
    )
  );

-- ── helper: public URL for a bucket + path ───────────────────────────────────
-- The JS client's getPublicUrl() already does this browser-side; this exists so
-- SQL and Postgres functions can hand back ready-to-render URLs (e.g. selecting
-- a property row plus its hero image URL in one query).
--
-- Does not check that the bucket is public — pass it a private bucket and you
-- get a URL that 400s. Both buckets created above are public.
--
-- Path encoding: only spaces are escaped. Keep object paths to
-- [a-z0-9._/-] (see slugify in storage-client.js) and this is exact; other
-- characters needing percent-encoding would pass through unescaped.
create or replace function public.storage_public_url(p_bucket text, p_path text)
returns text
language sql
immutable
as $$
  select case
    when p_bucket is null or p_path is null or p_path = '' then null
    else 'https://iubxycckgrplbpdbncfk.supabase.co/storage/v1/object/public/'
         || p_bucket || '/' || replace(ltrim(p_path, '/'), ' ', '%20')
  end;
$$;
grant execute on function public.storage_public_url(text, text) to anon, authenticated;

-- ── optional tightening: owner-folder writes ─────────────────────────────────
-- Uncomment this block (and drop the two broad policies above) to scope writes
-- to <auth.uid()>/<anything>, so a signed-in user can only touch their own
-- prefix. Admins keep full delete via the policy above. Requires uploading to
-- paths shaped `${user.id}/${propertyId}/${filename}` — storage-client.js
-- already builds paths that way.
--
-- drop policy if exists "authenticated uploads property photos" on storage.objects;
-- drop policy if exists "authenticated updates property photos" on storage.objects;
--
-- create policy "owner uploads own property photos" on storage.objects
--   for insert to authenticated
--   with check (
--     bucket_id in ('property-photos', 'property-thumbnails')
--     and (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "owner updates own property photos" on storage.objects
--   for update to authenticated
--   using (
--     bucket_id in ('property-photos', 'property-thumbnails')
--     and (storage.foldername(name))[1] = auth.uid()::text
--   )
--   with check (
--     bucket_id in ('property-photos', 'property-thumbnails')
--     and (storage.foldername(name))[1] = auth.uid()::text
--   );

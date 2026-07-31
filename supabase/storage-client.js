// Dan Cruz Homes — minimal storage client for property listing photos.
// Buckets and RLS policies live in supabase/storage_buckets.sql.
//
// No framework, no build step — an ES module, same as the CDN-script pattern in
// admin.html / grader.html. Use it from a page with:
//   <script type="module">
//     import { uploadPhoto, publicUrl } from './supabase/storage-client.js';
//   </script>
//
// Uploads require a signed-in user (the INSERT policy is scoped to the
// `authenticated` role). Reads are public and need no session.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://iubxycckgrplbpdbncfk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_L92hXORLG-Df4WiZxVq-6Q_X3AB47yl';

export const PHOTOS_BUCKET = 'property-photos';
export const THUMBNAILS_BUCKET = 'property-thumbnails';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Keeps object paths to [a-z0-9._-] so storage_public_url() in SQL doesn't have
// to percent-encode anything. Preserves the file extension.
function slugify(filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot).toLowerCase() : '';
  const clean = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (clean || 'photo') + ext;
}

// Upload a File/Blob and return { path, url }. Throws on failure.
//
// Path shape is `<user id>/<property id>/<slug>` — the leading user-id folder is
// what the optional owner-folder policies in storage_buckets.sql check, so
// tightening those later needs no client change.
export async function uploadPhoto(file, propertyId, { bucket = PHOTOS_BUCKET, upsert = false } = {}) {
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('must be signed in to upload');

  const path = `${user.id}/${propertyId}/${slugify(file.name)}`;

  const { error } = await sb.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert, // false → a second upload to the same path errors instead of clobbering
  });
  if (error) throw error;

  return { path, url: publicUrl(path, bucket) };
}

// Public URL for an already-uploaded object. Synchronous string build — no
// network call, no session needed, works for logged-out visitors.
export function publicUrl(path, bucket = PHOTOS_BUCKET) {
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// Same URL, built by the SQL helper instead — use when you want one source of
// truth shared with server-side queries.
export async function publicUrlViaRpc(path, bucket = PHOTOS_BUCKET) {
  const { data, error } = await sb.rpc('storage_public_url', { p_bucket: bucket, p_path: path });
  if (error) throw error;
  return data;
}

// List one property's photos, newest first. Returns [{ name, path, url }].
export async function listPhotos(userId, propertyId, bucket = PHOTOS_BUCKET) {
  const prefix = `${userId}/${propertyId}`;
  const { data, error } = await sb.storage.from(bucket).list(prefix, {
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) throw error;
  return data.map(o => ({ name: o.name, path: `${prefix}/${o.name}`, url: publicUrl(`${prefix}/${o.name}`, bucket) }));
}

// Admin-only — the DELETE policy requires profiles.is_admin. For a non-admin
// this resolves without throwing but removes nothing (RLS filters the row out),
// so check the returned count rather than just the absence of an error.
export async function deletePhoto(path, bucket = PHOTOS_BUCKET) {
  const { data, error } = await sb.storage.from(bucket).remove([path]);
  if (error) throw error;
  if (!data?.length) throw new Error('nothing deleted — admin access required');
  return data;
}

/* Example — wire a file input to an upload:

  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadPhoto(file, 'a1b2c3d4-property-uuid');
      document.getElementById('preview').src = url;
    } catch (err) {
      console.error('upload failed:', err.message);
    }
  });

*/

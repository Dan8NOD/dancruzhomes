# Dan Cruz Homes

Static HTML, no build step. Marketing site (`index.html`) + Property Readiness
Grader (`grader.html`) + agent admin view (`admin.html`), all talking directly
to Supabase (`iubxycckgrplbpdbncfk.supabase.co`) via the JS client loaded from
a CDN. Auth is Google OAuth through Supabase.

## The grader model

- **Free, any state, no limit:** signing in with Google and running the full
  6-part scorecard (condition, location, showing access, marketing, terms,
  pricing) — this is the lead magnet, so it stays open.
- **$10/mo (Stripe subscription, product `prod_UyId5X2lyBFXdu`):** saving a
  property so you can reopen it, sharing a read-only link, and getting
  feedback from dan cruz. This is the "portal."
- **Admin (`admin.html`):** dan cruz sees every submission across every
  state, can filter by state (for routing referrals to partner agents), and
  leaves feedback per property that the homeowner sees on their own copy.

## One-time setup

### 1. Database

Run [`supabase/portal_schema.sql`](supabase/portal_schema.sql) in the
Supabase SQL editor for the `iubxycckgrplbpdbncfk` project (same project
`grader.html` already points at). It creates `profiles`, `subscriptions`,
`properties`, and two security-definer functions (share-by-token lookup,
admin feedback write). Full comments on the security reasoning are in the
file itself.

This **supersedes** `supabase/grader_access.sql` (the old $5 one-time-payment
table) — that table is left alone (harmless) but nothing reads from it
anymore. Safe to `drop table if exists grader_access;` once you've confirmed
it's empty.

**Seed yourself as admin:** the schema file seeds
`dancruzconsultant@gmail.com` as admin automatically. If the Google account
you actually sign into dancruzhomes.com with is different, edit that email
in the SQL before running it (or re-run just that `insert` statement after
your first sign-in, since it needs your `auth.users` row to already exist).

### 2. Google sign-in

Already set up from the earlier pass (Authentication → Providers → Google in
the Supabase dashboard). Nothing new needed here.

### 3. Stripe

You already created the product: **`prod_UyId5X2lyBFXdu`**. The checkout
function attaches an inline $10/mo recurring price to that exact product
(no separate Price object to create by hand).

1. Get your **Secret key** from the Stripe dashboard (Developers → API keys).
   Run these yourself in a terminal — don't paste the raw key into chat:
   ```
   supabase functions deploy create-checkout
   supabase functions deploy create-portal-session
   supabase functions deploy stripe-webhook
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   ```
2. Add a webhook endpoint in the Stripe dashboard (Developers → Webhooks):
   `https://iubxycckgrplbpdbncfk.supabase.co/functions/v1/stripe-webhook`
   Events to send: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
3. Copy the webhook's **Signing secret** (starts `whsec_`) and set it:
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   The webhook verifies this signature before touching any payload — without
   it set correctly, all events will be rejected (safe default, not silent).
4. Also make sure these are set (needed by the functions, likely already
   present from other Supabase Edge Function usage):
   ```
   supabase secrets set SUPABASE_URL=https://iubxycckgrplbpdbncfk.supabase.co
   supabase secrets set SUPABASE_ANON_KEY=sb_publishable_L92hXORLG-Df4WiZxVq-6Q_X3AB47yl
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key, from Project Settings → API>
   ```

### 4. ConvertKit

For the disclaimer opt-in on first login (Fat Cat Asset Management umbrella emails):

```
supabase functions deploy subscribe-convertkit
supabase secrets set CONVERTKIT_API_KEY=<Settings → Advanced → API Key>
supabase secrets set CONVERTKIT_FORM_ID=<the form/sequence subscribers land in>
```

### 5. Logo

Save the PGS logo (navy badge, house + clipboard mark) to
[`public/pgs-logo.png`](public/pgs-logo.png) or directly to the repo root as
`pgs-logo.png` next to `grader.html` — it's already wired into the grader
header and will appear automatically once the file exists (it fails
silently/hides itself until then, so nothing breaks in the meantime).

## What changed from the $5 one-time version

The old flow (`grader_access` table, sections 3–6 blurred until payment) had
three real problems, all fixed in this pass:

1. **Data loss bug** — the old `syncToCloud()` ran a Supabase `insert()` on
   every single checkbox click, so nothing was ever a single, reopenable
   record. That's the direct cause of a client's "it wouldn't let me save"
   complaint. Save is now an explicit action that upserts one row per
   property in `properties`.
2. **Unsigned webhook** — the old Stripe webhook trusted any POSTed JSON with
   no signature check, so anyone who found the URL could fake a payment
   event and grant themselves free access. The new one verifies
   `Stripe-Signature` before processing anything.
3. **Anon-readable payment table** — `grader_access` had an RLS policy
   letting any anonymous request read every row, i.e. every paying
   customer's email, in the clear. Nothing in the new schema is bulk-anon-
   readable; sharing goes through a function scoped to one exact token.

## Deploy

GitHub Pages, same as before (`CNAME` → dancruzhomes.com). No build step —
push and it's live.

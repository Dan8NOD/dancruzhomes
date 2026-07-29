# Dan Cruz Homes

Static site, no build step, no bundler — every page works opened over plain
HTTP. Served at [dancruzhomes.com](https://dancruzhomes.com) via GitHub
Pages (`CNAME`), `main` is live the moment it's pushed.

## Pages

- **`index.html`** — marketing homepage (large minimalist home builder,
  Midwest, 50-home pipeline). Three lead forms (lot inquiry, buy/sell
  brokerage inquiry, agent partner application), a newsletter signup,
  MixMatch cross-promo, Market Notes teaser.
- **`grader.html`** — Property Readiness Grader. A 6-part scorecard
  (condition, location, showing access, marketing, terms, pricing) —
  **free and unlimited, no account needed to grade**. Google sign-in is
  only required to *save* a property, and unlocks the $10/mo portal (save,
  reopen, share a read-only link, get feedback from Dan).
- **`notes.html`** — Market Notes. Hand-authored posts (market updates,
  negotiation tactics, neighborhood spotlights) as `<article>` blocks on a
  single page — no CMS, no per-post files. Append new ones by hand.
- **`admin.html`** — internal, `noindex`. Two tabs: **Scorecards** (every
  submitted Property Readiness scorecard, filterable by state, with a
  per-property feedback box) and **Leads** (every `lead_submissions` row
  for this site, filterable by form type — read-only, no status editing
  yet).

## Data — Supabase project `iubxycckgrplbpdbncfk`

This project is **shared** with other Fat Cat Asset Management sites
(fatcatpm-portal uses the same instance) — table names are deliberately
specific to avoid collisions.

| Table | Written by | Purpose |
| --- | --- | --- |
| `lead_submissions` | `index.html`, anon insert | All homepage forms — a single table, `form_type` column (`lot_inquiry` \| `broker_partner` \| `brokerage_inquiry`) distinguishes them, not separate tables per form. Admin read via a dedicated policy — see [`supabase/lead_submissions_admin_policy.sql`](supabase/lead_submissions_admin_policy.sql), added because no admin-read policy existed before (only an owner-read policy, which anonymous submissions never satisfy). |
| `profiles` | `grader.html` | One row per signed-in user: `is_admin` flag, `consented_at` (disclaimer/ConvertKit opt-in timestamp). |
| `subscriptions` | Stripe webhook only | `$10/mo` portal access — `status`, Stripe customer/subscription IDs. Never written from the client. |
| `properties` | `grader.html`, owner-scoped | The actual saved scorecards: answers, score, `share_token` (read-only share link), `agent_feedback` (written only via the `admin_set_feedback` RPC, not a direct column update). |
| `grader_access` | *(unused)* | Leftover from an earlier $5-one-time-payment design, superseded by `subscriptions`. Nothing reads or writes it anymore; left in place rather than dropped in case rows already exist. Its RLS also allows anon to bulk-read every row — don't reuse that pattern. |

Full schema + RLS policies: [`supabase/portal_schema.sql`](supabase/portal_schema.sql).
Run once in the Supabase SQL editor; safe to re-run (`create table if not
exists`, `create policy` guarded by table existence).

## Auth

Google OAuth via Supabase Auth (`supabase.auth.signInWithOAuth({ provider:
'google' })`) — **not** magic-link. Configured in the Supabase dashboard
under Authentication → Providers, with a Google Cloud OAuth client. Only
`grader.html` and `admin.html` use it; the homepage has no auth.

## Money — Stripe

Real product `prod_UyId5X2lyBFXdu`, $10/mo, created inline via
`price_data` attached to that product id (no separate Price object to
manage in the Stripe dashboard). Flow:

1. `grader.html` → `create-checkout` Edge Function (identifies the caller
   from their own Supabase session JWT, never a client-supplied email) →
   Stripe Checkout URL.
2. Stripe → `stripe-webhook` Edge Function on `checkout.session.completed` /
   `customer.subscription.*` → upserts `subscriptions`. **Signature
   verified** before any payload is trusted (`STRIPE_WEBHOOK_SECRET`) — an
   earlier version of this webhook didn't verify signatures, which meant
   anyone who found the URL could POST a fake event and grant themselves
   free access. Don't remove that check.
3. `create-portal-session` — Stripe's hosted Billing Portal, so
   subscribers can self-serve cancel/update payment method.

Edge functions: [`supabase/functions/`](supabase/functions/) —
`create-checkout`, `create-portal-session`, `stripe-webhook`,
`subscribe-convertkit`. Every secret they need is a **name only** here
(`Deno.env.get('STRIPE_SECRET_KEY')` etc.) — actual values live in
Supabase's own secrets store (`supabase secrets set ...`), never in this
repo, never shipped to the browser. The Supabase anon key *is* safe to
hardcode client-side (that's what it's for) and is already inline in
`grader.html`/`admin.html`/`index.html`.

## Brand / social assets

Generated from the site's own palette (`#f5f0e6` paper, `#9a7d2e` gold,
Georgia serif) — `favicon.svg`, `apple-touch-icon.png`, `og-card.png`
(homepage link-preview), `og-grader.png` (grader link-preview, since
that's the URL people actually share). `pgs-logo.png` is the one asset not
in this repo — drop it at the root next to `grader.html` and it appears in
the grader header automatically (fails silently until then).

## Discoverability

`robots.txt` (allows all crawlers + named AI/answer-engine bots,
disallows `/admin.html`), `sitemap.xml` (namespace must stay
`sitemaps.org`, plural — a singular typo makes the whole file invalid and
search engines drop it silently), `llms.txt` (llmstxt.org convention —
whatever it claims gets repeated verbatim by AI assistants, so keep it
factually current whenever pricing or what's gated changes), JSON-LD on
`index.html` and `grader.html`.

## Cross-promo

The MixMatch cross-promo mini-ad (`mm-ad*` classes, in `index.html`) is
shared across NOD/Fat Cat sites. Edit one site at a time and copy/paste if
needed — not worth factoring into a shared include for a no-build static
site.

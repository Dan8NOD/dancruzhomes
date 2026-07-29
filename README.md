# Dan Cruz Homes
Rendered at https://dancruzhomes.com

Static single-page marketing site for Dan Cruz Homes (large minimalist home builder, Midwest, 50-home pipeline vision). Light mode only (no dark theme toggle — keeps phones cool).

## Stack
- Single `index.html` + `grader.html` (no bundler, no framework)
- Vanilla JS + CSS
- Mobile-first responsive
- GitHub Pages serves `main` as the live site

## Forms
Two forms post to the shared Supabase project (`iubxycckgrplbpdbncfk`):

- **Owner lot inquiry** (`index.html`) → table `lot_inquiries`
- **Agent partner application** (`index.html`) → table `agent_applications`
- **Property Readiness Grader** (`grader.html`) → magic-link login via Supabase Auth → `grader_access` + `marketability_submissions` tables
- **Stripe paywall** → Supabase Edge Function `create-checkout` returns a Checkout URL → return to `?status=success` → webhook `stripe-webhook` flips `grader_access.status='paid'`

Both project secrets are checked into the deploy path; no service-role key ever ships to the browser.

## Branch hygiene
- `main` only. Cut a feature branch, push, PR, merge.
- No direct pushes to `main` from agents — go through a branch so the diff is reviewable.

## Cross-promo
The MixMatch cross-promo mini-ad (`mm-ad*` classes) is shared across NOD sites. Edit one site at a time and copy/paste if needed — premature factoring.

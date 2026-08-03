// ponytail: server-side ConvertKit subscribe — keeps the API key out of the
// client bundle. Called on newsletter signup (index.html submitNewsletterForm)
// and once right after a user accepts the disclaimer on first login
// (see grader.html acceptDisclaimer()).
//
// Deploy: supabase functions deploy subscribe-convertkit
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//           CONVERTKIT_API_KEY, CONVERTKIT_FORM_ID (optional — see below)
//
// API VERSION: this calls ConvertKit/Kit's **v4** API, not v3. The account's
// key is a `kit_`-prefixed v4 key, which v3 rejects outright — verified:
//   GET api.kit.com/v4/account      + X-Kit-Api-Key  -> 200
//   GET api.convertkit.com/v3/account?api_key=...    -> 401 "API Key not valid"
// v4 authenticates by header, not by an `api_key` field in the body.
//
// DURABILITY: the previous version did nothing but call ConvertKit, and
// asserted its two env vars with `!`. Neither has ever been set on this
// project, so a signup would hit /v3/forms/undefined/subscribe, get a 404,
// and return 502 — the address was gone. This version writes the address to
// lead_submissions FIRST and treats ConvertKit as a best-effort second step,
// so a missing or broken ConvertKit config costs the list sync, never the lead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const API_KEY = Deno.env.get('CONVERTKIT_API_KEY') ?? ''
const FORM_ID = Deno.env.get('CONVERTKIT_FORM_ID') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors() } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() })
  try {
    const { email, first_name, source } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return json({ error: 'email required' }, 400)
    }

    // Step 1 — persist. Service role, so this does not depend on the
    // anonymous-insert RLS policy the homepage lead forms rely on.
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { error: insertErr } = await supa.from('lead_submissions').insert({
      site: 'dancruzhomes.com',
      form_type: 'newsletter',
      status: 'new',
      email,
      name: first_name || null,
      props: { source: source || 'newsletter' },
    })
    if (insertErr) {
      // Nothing captured the address anywhere — the only real failure.
      console.error('lead_submissions insert failed:', insertErr.message)
      return json({ error: 'Could not record signup' }, 500)
    }

    // Step 2 — best effort. Never fails the request: the address is already safe.
    if (!API_KEY || !FORM_ID) {
      console.warn('ConvertKit not configured; lead recorded, list sync skipped')
      return json({ ok: true, synced: false })
    }
    // Kit v4 is a TWO-step flow, and the order is not optional: posting
    // straight to /forms/{id}/subscribers with an address Kit has never seen
    // returns 404 "Not Found" (verified). The subscriber must exist first.
    const kitHeaders = {
      'Content-Type': 'application/json',
      'X-Kit-Api-Key': API_KEY,
    }
    try {
      const createRes = await fetch('https://api.kit.com/v4/subscribers', {
        method: 'POST',
        headers: kitHeaders,
        body: JSON.stringify({
          email_address: email,
          ...(first_name ? { first_name } : {}),
        }),
      })
      // Already-subscribed addresses are a success case, not an error — Kit
      // upserts, so a repeat signup should still get added to the form below.
      if (!createRes.ok) {
        console.error('Kit create-subscriber failed:', createRes.status, await createRes.text())
        return json({ ok: true, synced: false })
      }

      const formRes = await fetch(`https://api.kit.com/v4/forms/${FORM_ID}/subscribers`, {
        method: 'POST',
        headers: kitHeaders,
        body: JSON.stringify({ email_address: email }),
      })
      if (!formRes.ok) {
        console.error('Kit add-to-form failed:', formRes.status, await formRes.text())
        return json({ ok: true, synced: false })
      }
    } catch (err) {
      console.error('Kit subscribe threw:', String((err as Error)?.message || err))
      return json({ ok: true, synced: false })
    }

    return json({ ok: true, synced: true })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})

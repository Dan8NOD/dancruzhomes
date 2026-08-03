// ponytail: server-side ConvertKit subscribe — keeps the API key out of the
// client bundle. Called on newsletter signup (index.html submitNewsletterForm)
// and once right after a user accepts the disclaimer on first login
// (see grader.html acceptDisclaimer()).
//
// Deploy: supabase functions deploy subscribe-convertkit
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
//           CONVERTKIT_API_KEY, CONVERTKIT_FORM_ID (optional — see below)
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
    try {
      const res = await fetch(`https://api.convertkit.com/v3/forms/${FORM_ID}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: API_KEY, email, first_name }),
      })
      if (!res.ok) {
        console.error('ConvertKit subscribe failed:', res.status, await res.text())
        return json({ ok: true, synced: false })
      }
    } catch (err) {
      console.error('ConvertKit subscribe threw:', String((err as Error)?.message || err))
      return json({ ok: true, synced: false })
    }

    return json({ ok: true, synced: true })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})

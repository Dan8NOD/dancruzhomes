// ponytail: server-side ConvertKit subscribe — keeps the API key out of the
// client bundle. Called once, right after a user accepts the disclaimer on
// first login (see grader.html acceptDisclaimer()).
// Deploy: supabase functions deploy subscribe-convertkit
// Env vars: CONVERTKIT_API_KEY, CONVERTKIT_FORM_ID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const API_KEY = Deno.env.get('CONVERTKIT_API_KEY')!
const FORM_ID = Deno.env.get('CONVERTKIT_FORM_ID')!

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
    const { email, first_name } = await req.json()
    if (!email) return json({ error: 'email required' }, 400)

    const res = await fetch(`https://api.convertkit.com/v3/forms/${FORM_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY, email, first_name }),
    })
    if (!res.ok) {
      return json({ error: 'ConvertKit subscribe failed', detail: await res.text() }, 502)
    }
    return json({ ok: true })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})

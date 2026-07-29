// ponytail: lets a subscriber manage/cancel their own $10/mo plan — Stripe's
// hosted Billing Portal, no custom cancellation UI to build or secure.
// Deploy: supabase functions deploy create-portal-session
// Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
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
    const authHeader = req.headers.get('Authorization') || ''
    const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await supaAuth.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) return json({ error: 'Not signed in' }, 401)

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: sub } = await supa.from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    if (!sub?.stripe_customer_id) return json({ error: 'No subscription found' }, 404)

    const { return_url } = await req.json()
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: sub.stripe_customer_id, return_url }),
    })
    const session = await res.json()
    if (!res.ok) return json({ error: session.error?.message || 'Stripe error' }, 400)
    return json({ url: session.url })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})

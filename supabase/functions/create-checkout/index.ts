// ponytail: Supabase Edge Function — creates a Stripe Checkout session for the
// Property Grader Portal, $10/mo subscription attached to the real Stripe
// product (prod_UyId5X2lyBFXdu), not an ad-hoc "product_data" blob — so it
// shows up correctly in Stripe's own product/reporting UI.
//
// Deploy: supabase functions deploy create-checkout
// Env vars needed: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// Optional: STRIPE_PRICE_ID_GRADER (see below)
//
// SECURITY: the email charged is whoever the caller's own Supabase session
// JWT resolves to (via auth.getUser), never a client-supplied string — so
// there's no way to start a checkout "as" someone else's email.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// Preferred: a saved Stripe Price object, set as STRIPE_PRICE_ID_GRADER.
// A saved Price is what makes promotional pricing workable — a Black Friday
// signup can be grandfathered onto its own Price at renewal, and the discount
// segments in Stripe reporting. Inline price_data can do neither.
//
// Falls back to the original inline price_data when the env var is unset, so
// this function keeps working before the Price object exists.
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID_GRADER') ?? ''
const PRODUCT_ID = 'prod_UyId5X2lyBFXdu' // Property Grader Portal
const AMOUNT = 1000 // $10.00/mo, cents — only used on the fallback path
const CURRENCY = 'usd'

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
    const jwt = authHeader.replace('Bearer ', '')
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await supa.auth.getUser(jwt)
    if (userErr || !user?.email) {
      return json({ error: 'Not signed in' }, 401)
    }

    const { success_url, cancel_url } = await req.json()
    if (!success_url || !cancel_url) {
      return json({ error: 'Missing success_url or cancel_url' }, 400)
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'customer_email': user.email,
        'line_items[0][quantity]': '1',
        ...(PRICE_ID
          ? { 'line_items[0][price]': PRICE_ID }
          : {
              'line_items[0][price_data][currency]': CURRENCY,
              'line_items[0][price_data][unit_amount]': String(AMOUNT),
              'line_items[0][price_data][recurring][interval]': 'month',
              'line_items[0][price_data][product]': PRODUCT_ID,
            }),
        // Without this, Stripe Checkout renders no promo-code field and every
        // coupon is unredeemable no matter what exists in the dashboard.
        'allow_promotion_codes': 'true',
        'success_url': success_url,
        'cancel_url': cancel_url,
        'client_reference_id': user.id,
        'metadata[user_id]': user.id,
        'metadata[email]': user.email,
        'subscription_data[metadata][user_id]': user.id,
      }),
    })

    const session = await res.json()
    if (!res.ok) {
      return json({ error: session.error?.message || 'Stripe error' }, 400)
    }
    return json({ url: session.url })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})

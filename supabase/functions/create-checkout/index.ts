// ponytail: Supabase Edge Function — creates Stripe Checkout session for grader $5 paywall
// Deploy: supabase functions deploy create-checkout
// Env vars needed: STRIPE_SECRET_KEY
// Returns: { url: "https://checkout.stripe.com/..." }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')!
// ponytail: $5.00 one-time — hardcoded, not a recurring price
const AMOUNT = 500 // cents
const CURRENCY = 'usd'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    })
  }

  try {
    const { email, success_url, cancel_url } = await req.json()

    if (!email || !success_url || !cancel_url) {
      return new Response(JSON.stringify({ error: 'Missing email, success_url, or cancel_url' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Create Stripe Checkout session
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'customer_email': email,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': CURRENCY,
        'line_items[0][price_data][unit_amount]': String(AMOUNT),
        'line_items[0][price_data][product_data][name]': 'Property Readiness Grader — Full Access',
        'success_url': success_url,
        'cancel_url': cancel_url,
        'metadata[email]': email,
        'metadata[product]': 'grader_full_access',
      }),
    })

    const session = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: session.error?.message || 'Stripe error' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

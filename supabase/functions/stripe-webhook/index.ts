// ponytail: Supabase Edge Function — Stripe webhook receiver
// Deploy: supabase functions deploy stripe-webhook
// Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// In Stripe dashboard: add webhook endpoint → https://<project>.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.text()
    const event = JSON.parse(body)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const email = session.customer_email || session.metadata?.email

      if (!email) {
        return new Response(JSON.stringify({ error: 'No email in session' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Record payment in grader_access table
      const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { error } = await supa.from('grader_access').upsert({
        email,
        status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_session_id: session.id,
        amount_paid: session.amount_total,
      }, { onConflict: 'email' })

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

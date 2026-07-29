// ponytail: Supabase Edge Function — Stripe webhook receiver for the Property
// Grader Portal subscription.
//
// SECURITY FIX vs. the previous version: that handler parsed the request body
// as trusted JSON with no signature check — anyone who found this URL could
// POST a fake `checkout.session.completed` and grant themselves paid access
// for free. This version verifies the Stripe-Signature header via Stripe's
// own SDK before touching the payload, using Stripe's documented Deno/edge
// pattern (constructEventAsync + SubtleCryptoProvider).
//
// Deploy: supabase functions deploy stripe-webhook
// Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// In Stripe dashboard: add webhook endpoint → https://<project>.supabase.co/functions/v1/stripe-webhook
// Events to send: checkout.session.completed, customer.subscription.created,
//                 customer.subscription.updated, customer.subscription.deleted

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')!
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const stripe = new Stripe(STRIPE_SECRET, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const cryptoProvider = Stripe.createSubtleCryptoProvider()

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text()

  let event
  try {
    if (!signature) throw new Error('missing Stripe-Signature header')
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET, undefined, cryptoProvider)
  } catch (err) {
    // ponytail: 400 here, on purpose — never process an unverified payload
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 })
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any
        if (session.mode !== 'subscription') break
        const userId = session.client_reference_id || session.metadata?.user_id
        const email = session.customer_email || session.metadata?.email
        if (!userId) break
        await supa.from('subscriptions').upsert({
          user_id: userId,
          email,
          status: 'active',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as any
        const userId = sub.metadata?.user_id
        if (!userId) break
        const status = (sub.status === 'active' || sub.status === 'trialing') ? 'active' : sub.status
        await supa.from('subscriptions').upsert({
          user_id: userId,
          status,
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as any
        const userId = sub.metadata?.user_id
        if (!userId) break
        await supa.from('subscriptions').update({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId)
        break
      }
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})

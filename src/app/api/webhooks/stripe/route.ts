import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2026-09-30.endive',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session | Stripe.Invoice;
      
      // Determine user ID depending on object type
      let userId: string | null = null;

      if (event.type === 'checkout.session.completed') {
        const checkoutSession = session as Stripe.Checkout.Session;
        userId = checkoutSession.client_reference_id || checkoutSession.metadata?.userId || null;
      } else if (event.type === 'invoice.payment_succeeded') {
        const invoice = session as Stripe.Invoice;
        // Invoices might not have client_reference_id directly on them if not passed down.
        // Usually, you look up the subscription or customer metadata. 
        // For now, assume we attach customer metadata or subscription metadata when creating.
        // We'll rely primarily on checkout.session.completed to activate the account.
        
        // As a fallback for renewals, we should look up the user by stripe_customer_id if we saved it,
        // but we'll leave that for a robust billing implementation.
      }

      if (userId) {
        // Upgrade the user in Supabase
        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_tier: 'pro',
            ai_scans_limit: 500, // 500 scans per month limit
          })
          .eq('id', userId);

        if (error) {
          console.error('Error updating user profile in Supabase:', error);
          return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }
        console.log(`Successfully upgraded user ${userId} to Pro.`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('Unhandled webhook error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

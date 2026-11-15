import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { PLANS } from './plans';
import { SupabaseService } from './supabase.service';

const PRICE_LOOKUP_KEY = 'pdf_studio_pro_monthly';

/**
 * Stripe subscriptions for the Pro plan. The product, price and customer-portal settings are
 * created on first use, so a fresh Stripe account (or sandbox) needs no dashboard setup.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string | undefined;
  private priceId: Promise<string> | null = null;
  private portalConfig: Promise<string> | null = null;

  constructor(
    config: ConfigService,
    private readonly db: SupabaseService,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET');
  }

  get enabled() {
    return !!this.stripe && this.db.enabled;
  }

  private need(): Stripe {
    if (!this.stripe || !this.db.enabled) throw new ServiceUnavailableException('Billing is not configured on this server.');
    return this.stripe;
  }

  private price(): Promise<string> {
    return (this.priceId ??= (async () => {
      const stripe = this.need();
      const found = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
      if (found.data[0]) return found.data[0].id;
      const product = await stripe.products.create({
        name: 'PDF Studio Pro',
        description: 'Unlimited cloud documents and 500,000 translation characters a month.',
      });
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: Math.round(PLANS.pro.priceEur * 100),
        recurring: { interval: 'month' },
        lookup_key: PRICE_LOOKUP_KEY,
      });
      return price.id;
    })().catch((e) => {
      this.priceId = null;
      throw e;
    }));
  }

  private portal(): Promise<string> {
    return (this.portalConfig ??= (async () => {
      const stripe = this.need();
      const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
      if (existing.data[0]) return existing.data[0].id;
      const made = await stripe.billingPortal.configurations.create({
        business_profile: { headline: 'PDF Studio: manage your Pro plan' },
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: 'at_period_end' },
        },
      });
      return made.id;
    })().catch((e) => {
      this.portalConfig = null;
      throw e;
    }));
  }

  private async customerFor(user: User): Promise<string> {
    const stripe = this.need();
    const profile = await this.db.profile(user.id);
    if (profile.stripe_customer_id) return profile.stripe_customer_id;
    const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
    await this.db.updateProfile({ id: user.id }, { stripe_customer_id: customer.id });
    return customer.id;
  }

  async checkout(user: User, origin: string) {
    const stripe = this.need();
    const profile = await this.db.profile(user.id);
    if (profile.plan === 'pro') throw new BadRequestException('You are already on Pro.');
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: await this.customerFor(user),
      client_reference_id: user.id,
      line_items: [{ price: await this.price(), quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: true,
      success_url: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?billing=cancelled`,
    });
    return { url: session.url };
  }

  async portalSession(user: User, origin: string) {
    const stripe = this.need();
    const session = await stripe.billingPortal.sessions.create({
      customer: await this.customerFor(user),
      configuration: await this.portal(),
      return_url: `${origin}/`,
    });
    return { url: session.url };
  }

  /** Re-reads the user's subscription from Stripe (used right after checkout, before the webhook lands). */
  async sync(user: User) {
    const stripe = this.need();
    const profile = await this.db.profile(user.id);
    if (!profile.stripe_customer_id) return { plan: profile.plan };
    const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'all', limit: 5 });
    const live = subs.data.find((s) => s.status === 'active' || s.status === 'trialing') ?? subs.data[0];
    if (live) await this.apply(live);
    else await this.db.updateProfile({ id: user.id }, { plan: 'free', subscription_status: null, stripe_subscription_id: null });
    return { plan: (await this.db.profile(user.id)).plan };
  }

  /** Verifies and handles a Stripe webhook event. */
  async webhook(raw: Buffer | undefined, signature: string | undefined) {
    const stripe = this.need();
    if (!this.webhookSecret) throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not set.');
    if (!raw || !signature) throw new BadRequestException('Missing body or signature.');
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, this.webhookSecret);
    } catch (e) {
      throw new BadRequestException(`Invalid signature: ${(e as Error).message}`);
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.subscription) await this.apply(await stripe.subscriptions.retrieve(String(s.subscription)));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.apply(event.data.object);
        break;
      default:
        break;
    }
    return { received: true };
  }

  private async apply(sub: Stripe.Subscription) {
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const active = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
    // Newer API versions keep the period on the subscription item.
    const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data[0]?.current_period_end;
    await this.db.updateProfile(
      { stripe_customer_id: customer },
      {
        plan: active ? 'pro' : 'free',
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        current_period_end: end ? new Date(end * 1000).toISOString() : null,
      },
    );
    this.log.log(`Subscription ${sub.id} → ${sub.status}`);
  }
}

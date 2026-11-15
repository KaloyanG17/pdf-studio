// Registers the Stripe webhook for a deployed site and prints only the signing secret, so it can
// be piped into `vercel env add STRIPE_WEBHOOK_SECRET production`.
//   node scripts/setup-stripe-webhook.mjs https://your-site.vercel.app
import { existsSync, readFileSync } from 'node:fs';
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY && existsSync('.env.local'))
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
const site = process.argv[2]?.replace(/\/$/, '');
if (!site) throw new Error('Usage: node scripts/setup-stripe-webhook.mjs <site url>');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const url = `${site}/api/billing/webhook`;
const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url);
if (existing) await stripe.webhookEndpoints.del(existing.id); // the secret is only shown on creation
const made = await stripe.webhookEndpoints.create({
  url,
  enabled_events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'],
  description: 'PDF Studio: keeps profiles.plan in sync',
});
process.stdout.write(made.secret);

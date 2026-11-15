import { BadRequestException, Body, Controller, Get, Global, Headers, HttpCode, Module, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { PLANS } from './plans';
import { SupabaseService } from './supabase.service';

/** The site's own origin, for Stripe's return URLs. */
function originOf(req: Request) {
  const origin = req.headers.origin;
  if (origin) return origin;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  return `${proto}://${host}`;
}

@Controller()
export class AccountController {
  constructor(
    private readonly db: SupabaseService,
    private readonly billing: BillingService,
  ) {}

  /** Public settings for the browser: Supabase URL and publishable key, plans. */
  @Get('config')
  config() {
    return {
      accounts: this.db.enabled ? { url: this.db.url, key: this.db.publicKey } : null,
      billing: this.billing.enabled,
      plans: PLANS,
    };
  }

  /**
   * Creates an account that can sign in straight away. Done on the server so sign-up doesn't
   * depend on confirmation e-mails (Supabase's built-in mailer allows only a few per hour).
   */
  @Post('auth/signup')
  async signup(@Body() body: { email?: string; password?: string }) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter a valid e-mail address.');
    if (password.length < 8) throw new BadRequestException('Use a password of at least 8 characters.');
    const admin = this.db.admin;
    if (!admin) throw new BadRequestException('Accounts are not configured on this server.');
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new BadRequestException('An account with this e-mail already exists. Sign in instead.');
      throw new BadRequestException(error.message);
    }
    return { ok: true };
  }

  /** The signed-in user's plan, usage and cloud storage. */
  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.db.requireUser(req);
    const profile = await this.db.profile(user.id);
    return {
      email: user.email,
      plan: profile.plan,
      subscription: profile.subscription_status ? { status: profile.subscription_status, renews: profile.current_period_end } : null,
      usage: await this.db.usage(`u:${user.id}`, profile.plan),
      cloud: { used: await this.db.cloudCount(user.id), limit: PLANS[profile.plan].cloudDocs },
    };
  }

  /** Remaining translation for guests (shown on the home page). */
  @Get('usage')
  async usage(@Req() req: Request) {
    if (!this.db.enabled) return null;
    const { plan, subject } = await this.db.quotaFor(req);
    return { plan, ...(await this.db.usage(subject, plan)) };
  }

  @Post('billing/checkout')
  async checkout(@Req() req: Request) {
    return this.billing.checkout(await this.db.requireUser(req), originOf(req));
  }

  @Post('billing/portal')
  async portal(@Req() req: Request) {
    return this.billing.portalSession(await this.db.requireUser(req), originOf(req));
  }

  @Post('billing/sync')
  async sync(@Req() req: Request) {
    return this.billing.sync(await this.db.requireUser(req));
  }

  @Post('billing/webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.billing.webhook(req.rawBody, signature);
  }
}

@Global()
@Module({ controllers: [AccountController], providers: [SupabaseService, BillingService], exports: [SupabaseService] })
export class AccountModule {}

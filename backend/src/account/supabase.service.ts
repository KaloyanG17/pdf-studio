import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Request } from 'express';
import { PLANS, periodKey, type PlanId } from './plans';

export interface Profile {
  id: string;
  email: string | null;
  plan: 'free' | 'pro';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
}

/**
 * Server-side Supabase access with the service-role key. Accounts are optional: without the
 * Supabase env vars the app runs exactly as before (local library, no quotas).
 */
@Injectable()
export class SupabaseService {
  private readonly log = new Logger(SupabaseService.name);
  readonly admin: SupabaseClient | null;
  readonly url: string | undefined;
  readonly publicKey: string | undefined;

  constructor(config: ConfigService) {
    this.url = config.get('SUPABASE_URL') || config.get('NEXT_PUBLIC_SUPABASE_URL');
    this.publicKey = config.get('SUPABASE_PUBLISHABLE_KEY') || config.get('SUPABASE_ANON_KEY');
    const secret = config.get<string>('SUPABASE_SECRET_KEY') || config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.admin = this.url && secret ? createClient(this.url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
    this.log.log(this.admin ? 'Accounts enabled (Supabase)' : 'Accounts disabled: no Supabase env vars');
  }

  get enabled() {
    return !!this.admin;
  }

  private need(): SupabaseClient {
    if (!this.admin) throw new ServiceUnavailableException('Accounts are not configured on this server.');
    return this.admin;
  }

  /** The signed-in user from the request's bearer token, or null for guests. */
  async userFrom(req: Request): Promise<User | null> {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !this.admin) return null;
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Your session has expired. Sign in again.');
    return data.user;
  }

  async requireUser(req: Request): Promise<User> {
    this.need();
    const user = await this.userFrom(req);
    if (!user) throw new UnauthorizedException('Sign in first.');
    return user;
  }

  async profile(userId: string): Promise<Profile> {
    const db = this.need();
    const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (data) return data as Profile;
    // Users created before the trigger existed: create the row now.
    const { data: made, error: e2 } = await db.from('profiles').upsert({ id: userId }).select('*').single();
    if (e2) throw e2;
    return made as Profile;
  }

  async updateProfile(match: { id?: string; stripe_customer_id?: string }, patch: Partial<Profile>) {
    const db = this.need();
    let q = db.from('profiles').update(patch);
    if (match.id) q = q.eq('id', match.id);
    if (match.stripe_customer_id) q = q.eq('stripe_customer_id', match.stripe_customer_id);
    const { error } = await q;
    if (error) throw error;
  }

  /** Which plan and usage bucket a request counts against. */
  async quotaFor(req: Request): Promise<{ plan: PlanId; subject: string; user: User | null }> {
    const user = await this.userFrom(req);
    if (user) return { plan: (await this.profile(user.id)).plan, subject: `u:${user.id}`, user };
    // Guests are counted per IP. Only a hash is stored.
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    return { plan: 'guest', subject: `ip:${createHash('sha256').update(`pdf-studio:${ip}`).digest('hex').slice(0, 32)}`, user: null };
  }

  /** Counts translated characters against the plan; throws 402 when the quota is used up. */
  async consumeTranslation(req: Request, chars: number) {
    if (!this.admin || chars <= 0) return;
    const { plan, subject } = await this.quotaFor(req);
    const p = PLANS[plan];
    const { data, error } = await this.admin.rpc('consume_usage', {
      p_subject: subject,
      p_period: periodKey(p.period),
      p_chars: chars,
      p_cap: p.translateChars,
    });
    if (error) {
      this.log.error(`Usage check failed: ${error.message}`); // never block translation on a metering hiccup
      return;
    }
    if (data === null) {
      const next = plan === 'guest' ? 'Create a free account for 20,000 characters a month.' : plan === 'free' ? 'Upgrade to Pro for 500,000 characters a month.' : 'It resets at the start of next month.';
      throw new HttpException(
        { statusCode: 402, error: 'quota_exceeded', plan, message: `You've used this ${p.period}'s ${p.translateChars.toLocaleString('en')} translation characters. ${next}` },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async usage(subject: string, plan: PlanId) {
    const p = PLANS[plan];
    const { data } = await this.need().from('usage').select('chars').eq('subject', subject).eq('period', periodKey(p.period)).maybeSingle();
    return { used: (data?.chars as number | undefined) ?? 0, limit: p.translateChars, period: p.period };
  }

  async cloudCount(userId: string) {
    const { count } = await this.need().from('documents').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    return count ?? 0;
  }
}

/** What each plan includes. The database enforces the cloud limit; the API enforces quotas. */
export const PLANS = {
  guest: { name: 'Guest', translateChars: 5_000, period: 'day', cloudDocs: 0 },
  free: { name: 'Free', translateChars: 20_000, period: 'month', cloudDocs: 3 },
  pro: { name: 'Pro', translateChars: 500_000, period: 'month', cloudDocs: null, priceEur: 4.99 },
} as const;

export type PlanId = keyof typeof PLANS;

/** Usage bucket for a period: "2026-11" for monthly quotas, "2026-11-15" for daily ones. */
export function periodKey(period: 'day' | 'month', at = new Date()) {
  const iso = at.toISOString();
  return period === 'day' ? iso.slice(0, 10) : iso.slice(0, 7);
}

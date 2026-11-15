import { useState } from 'react';
import { openBillingPortal, signIn, signOut, signUp, startCheckout, useCloud, type PlanInfo } from '../lib/cloud';
import { Modal } from './Dialogs';
import { Icon } from './Icon';

const fmt = (n: number) => n.toLocaleString('en');

/** "Sign in" or the account chip, for the home header and the editor toolbar. */
export function AccountButton() {
  const config = useCloud((s) => s.config);
  const session = useCloud((s) => s.session);
  const me = useCloud((s) => s.me);
  const setDialog = useCloud((s) => s.setDialog);
  if (!config?.accounts) return null;
  if (!session)
    return (
      <button className="ghost" onClick={() => setDialog({ kind: 'signin' })}>
        <Icon name="user" size={16} /> Sign in
      </button>
    );
  return (
    <button className="ghost account-chip" onClick={() => setDialog({ kind: 'account' })} title={session.user.email}>
      <Icon name="user" size={16} />
      <span className="account-email">{session.user.email}</span>
      {me?.plan === 'pro' && <span className="pro-badge">Pro</span>}
    </button>
  );
}

/** Every account dialog, driven by the cloud store so any part of the app can open one. */
export function AccountDialogs() {
  const dialog = useCloud((s) => s.dialog);
  const setDialog = useCloud((s) => s.setDialog);
  const close = () => setDialog(null);
  if (!dialog) return null;
  if (dialog.kind === 'signin') return <SignInDialog onClose={close} />;
  if (dialog.kind === 'upgrade') return <UpgradeDialog reason={dialog.reason} onClose={close} />;
  return <AccountDialog onClose={close} />;
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'in' ? signIn(email, password) : signUp(email, password));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'in' ? 'Sign in' : 'Create a free account'} onClose={onClose}>
      <p className="muted">
        {mode === 'in'
          ? 'Your documents follow you to any computer, and you get a bigger translation allowance.'
          : 'Free: 3 documents in the cloud and 20,000 translation characters a month. No card needed.'}
      </p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'up' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="solid" disabled={busy}>
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="muted small">
        {mode === 'in' ? 'New here? ' : 'Already have an account? '}
        <button className="link" onClick={() => (setMode(mode === 'in' ? 'up' : 'in'), setError(null))}>
          {mode === 'in' ? 'Create a free account' : 'Sign in'}
        </button>
      </p>
    </Modal>
  );
}

function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="faint">{limit === null ? `${fmt(used)} · unlimited` : `${fmt(used)} of ${fmt(limit)}`}</span>
      </div>
      <div className="meter-bar">
        <span style={{ width: `${limit === null ? 4 : pct}%` }} className={pct >= 90 ? 'full' : ''} />
      </div>
    </div>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const me = useCloud((s) => s.me);
  const billing = useCloud((s) => s.config?.billing);
  const session = useCloud((s) => s.session);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const pro = me?.plan === 'pro';
  return (
    <Modal title="Your account" onClose={onClose}>
      <div className="account-head">
        <div>
          <div className="account-email-big">{session?.user.email}</div>
          <div className="faint small">
            {pro
              ? me?.subscription?.renews
                ? `Pro · ${me.subscription.status === 'active' ? 'renews' : 'ends'} ${new Date(me.subscription.renews).toLocaleDateString()}`
                : 'Pro'
              : 'Free plan'}
          </div>
        </div>
        <span className={`plan-pill ${pro ? 'pro' : ''}`}>{pro ? 'Pro' : 'Free'}</span>
      </div>
      {me && (
        <>
          <Meter used={me.usage.used} limit={me.usage.limit} label={`Translation this ${me.usage.period}`} />
          <Meter used={me.cloud.used} limit={me.cloud.limit} label="Documents in the cloud" />
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-foot">
        <button className="ghost" onClick={() => void signOut()}>
          Sign out
        </button>
        <span className="grow" />
        {billing &&
          (pro ? (
            <button className="ghost" disabled={busy} onClick={go(openBillingPortal)}>
              Manage billing
            </button>
          ) : (
            <button className="solid" disabled={busy} onClick={go(startCheckout)}>
              {busy ? 'Opening checkout…' : 'Upgrade to Pro'}
            </button>
          ))}
      </div>
      {billing && !pro && <p className="faint small">Test mode: pay with card 4242 4242 4242 4242, any future date and CVC.</p>}
    </Modal>
  );
}

function UpgradeDialog({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const plans = useCloud((s) => s.config?.plans);
  const billing = useCloud((s) => s.config?.billing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Upgrade to Pro" onClose={onClose}>
      {reason && <p>{reason}</p>}
      {plans && <PlanCard id="pro" plan={plans.pro} />}
      {error && <p className="error">{error}</p>}
      <div className="modal-foot">
        <button className="ghost" onClick={onClose}>
          Not now
        </button>
        {billing && (
          <button
            className="solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await startCheckout();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Opening checkout…' : `Upgrade for €${plans?.pro.priceEur}/month`}
          </button>
        )}
      </div>
    </Modal>
  );
}

function features(id: 'guest' | 'free' | 'pro', p: PlanInfo) {
  return [
    'Edit, translate, sign and export',
    `${fmt(p.translateChars)} translation characters a ${p.period}`,
    p.cloudDocs === 0 ? 'Library on this computer' : p.cloudDocs === null ? 'Unlimited documents in the cloud' : `${p.cloudDocs} documents in the cloud`,
    ...(id === 'pro' ? ['Cancel any time'] : []),
  ];
}

function PlanCard({ id, plan, current, action }: { id: 'guest' | 'free' | 'pro'; plan: PlanInfo; current?: boolean; action?: React.ReactNode }) {
  return (
    <div className={`plan glass ${id === 'pro' ? 'featured' : ''}`}>
      <div className="plan-name">
        {plan.name} {current && <span className="faint small">· your plan</span>}
      </div>
      <div className="plan-price">
        {plan.priceEur ? (
          <>
            €{plan.priceEur}
            <span className="faint">/month</span>
          </>
        ) : (
          'Free'
        )}
      </div>
      <ul>
        {features(id, plan).map((f) => (
          <li key={f}>
            <Icon name="check" size={16} /> {f}
          </li>
        ))}
      </ul>
      {action}
    </div>
  );
}

/** Pricing section on the home page. */
export function Pricing() {
  const config = useCloud((s) => s.config);
  const session = useCloud((s) => s.session);
  const me = useCloud((s) => s.me);
  const setDialog = useCloud((s) => s.setDialog);
  if (!config?.accounts) return null;
  const current = !session ? 'guest' : me?.plan ?? 'free';
  return (
    <section className="pricing">
      <h2>Plans</h2>
      <div className="plans">
        <PlanCard id="guest" plan={config.plans.guest} current={current === 'guest'} />
        <PlanCard
          id="free"
          plan={config.plans.free}
          current={current === 'free'}
          action={!session && <button className="ghost" onClick={() => setDialog({ kind: 'signin' })}>Create free account</button>}
        />
        <PlanCard
          id="pro"
          plan={config.plans.pro}
          current={current === 'pro'}
          action={
            config.billing &&
            current !== 'pro' && (
              <button className="solid" onClick={() => setDialog(session ? { kind: 'upgrade' } : { kind: 'signin' })}>
                {session ? 'Upgrade' : 'Sign in to upgrade'}
              </button>
            )
          }
        />
      </div>
    </section>
  );
}

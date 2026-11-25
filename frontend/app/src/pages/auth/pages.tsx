import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { useSite, type Site } from '@/lib/site';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { cn } from '@/lib/utils';

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

export function passwordRules(auth: Site['auth']) {
  return [
    { label: `At least ${auth.min_password_length} characters`, test: (p: string) => p.length >= auth.min_password_length },
    auth.require_uppercase && { label: 'An uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
    auth.require_lowercase && { label: 'A lowercase letter', test: (p: string) => /[a-z]/.test(p) },
    auth.require_digit && { label: 'A number', test: (p: string) => /\d/.test(p) },
    auth.require_symbol && { label: 'A symbol', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
  ].filter(Boolean) as { label: string; test: (p: string) => boolean }[];
}

export function PasswordChecklist({ password, min }: { password: string; min?: number }) {
  const site = useSite();
  const rules = passwordRules({ ...site.auth, min_password_length: min ?? site.auth.min_password_length });
  return (
    <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {rules.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.label} className={cn('flex items-center gap-1.5', ok ? 'text-success' : 'text-ink-muted')}>
            {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}{r.label}
          </li>
        );
      })}
    </ul>
  );
}

export function LoginPage() {
  const t = useT();
  const { login, completeMfa, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav(loc.state?.from ?? homeFor(user), { replace: true });
  }, [user, nav, loc.state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      if (challenge) {
        await completeMfa(challenge, code);
      } else {
        const r = await login(email, password);
        if (r.mfa_required) setChallenge(r.challenge);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CHALLENGE') {
        setChallenge(null);
        setCode('');
      }
      setUnverified(err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED');
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const [info, setInfo] = useState<string | null>(null);
  const resend = async () => {
    await api('/api/v1/auth/email/resend', { method: 'POST', body: { email }, auth: false }).catch(() => undefined);
    setError(null);
    setUnverified(false);
    setInfo('If your address still needs verifying, a new link is on its way.');
  };

  if (challenge) {
    return (
      <AuthLayout title="Two-factor verification" subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Verification code" required>
            {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text"
              autoFocus placeholder="123 456" className="text-center font-mono text-lg tracking-[0.3em]" />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.trim().length < 6}><ShieldCheck />Verify</Button>
          <button type="button" className="w-full text-center text-sm text-ink-muted hover:text-ink" onClick={() => { setChallenge(null); setCode(''); setError(null); }}>
            Use a different account
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.sign_in_title', 'Sign in to Alumni Portal')} subtitle="Access your alumni account and stay connected with the SST community."
      footer={<>{t('auth.no_account', 'New here?')} <Link to="/register" className="font-medium text-primary hover:underline">{t('auth.register', 'Create an alumni account')}</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <Alert tone="danger">
            {error}
            {unverified && <> <button type="button" className="font-medium text-primary underline" onClick={resend}>Resend the link</button></>}
          </Alert>
        )}
        {info && <Alert tone="success">{info}</Alert>}
        <Field label={t('auth.email', 'Email address')} required>
          {(id) => (
            <div className="relative">
              <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="ps-9" placeholder="you@example.com" autoFocus />
            </div>
          )}
        </Field>
        <Field label={t('auth.password', 'Password')} required>
          {(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">{t('auth.forgot', 'Forgot password?')}</Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!email || !password}><Lock />{t('auth.sign_in', 'Sign in')}</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/auth/password/forgot', { method: 'POST', body: { email }, auth: false });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for {email}, a reset link is on its way. The link is valid for 60 minutes.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email address" required>
            {(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!email}><Mail />Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const site = useSite();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = passwordRules(site.auth).every((r) => r.test(password)) && password === confirm;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/auth/password/reset', { method: 'POST', body: { token, password }, auth: false });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!token) {
    return (
      <AuthLayout title="Reset link missing" footer={<Link to="/forgot-password" className="font-medium text-primary hover:underline">Request a new link</Link>}>
        <Alert tone="warning">Open the link from your email again, or request a new one.</Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" subtitle="Other devices will be signed out.">
      {done ? (
        <div className="space-y-4">
          <Alert tone="success" title="Password updated">You can now sign in with your new password.</Alert>
          <Button asChild className="w-full" size="lg"><Link to="/login">Sign in</Link></Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password" required>
            {(id, d) => (<><PasswordInput id={id} aria-describedby={d} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              <PasswordChecklist password={password} /></>)}
          </Field>
          <Field label="Confirm new password" required error={confirm && confirm !== password ? 'Passwords do not match.' : undefined}>
            {(id, d) => <PasswordInput id={id} aria-describedby={d} aria-invalid={!!confirm && confirm !== password} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!valid}><KeyRound />Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'error'>(token ? 'working' : 'error');
  const [message, setMessage] = useState('The verification link is missing or incomplete.');
  useEffect(() => {
    if (!token) return;
    api('/api/v1/auth/email/verify', { method: 'POST', body: { token }, auth: false })
      .then(() => setState('ok'))
      .catch((e) => { setMessage(errorText(e)); setState('error'); });
  }, [token]);
  return (
    <AuthLayout title="Email verification" footer={<Link to="/login" className="font-medium text-primary hover:underline">Go to sign in</Link>}>
      {state === 'working' && <p className="text-center text-sm text-ink-muted">Verifying your email address…</p>}
      {state === 'ok' && <Alert tone="success" title="Email verified">Your email address is confirmed. You can now sign in.</Alert>}
      {state === 'error' && <Alert tone="danger" title="We couldn't verify your email">{message}</Alert>}
    </AuthLayout>
  );
}

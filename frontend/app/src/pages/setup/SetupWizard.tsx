import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Database, HardDrive, ImagePlus, KeyRound, Mail, Palette, PartyPopper,
  RefreshCw, ShieldCheck, Sparkles, Building2, UserRound, Globe, XCircle } from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth, type User } from '@/lib/auth';
import { applyTheme, type Branding, type Colors, type MediaItem, useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, Spinner } from '@/components/ui/display';
import { ColorInput, Field, Input, PasswordInput, Select, Switch } from '@/components/ui/form';
import { PasswordChecklist, passwordRules } from '@/pages/auth/pages';

type Status = {
  installed: boolean; checks?: Record<string, { ok: boolean; message: string }>; bundled_storage?: boolean;
  environment?: string; mail_catcher?: boolean;
};

const STEPS = [
  { key: 'welcome', label: 'Welcome', icon: Sparkles },
  { key: 'database', label: 'Database', icon: Database },
  { key: 'url', label: 'Application URL', icon: Globe },
  { key: 'institution', label: 'Institution', icon: Building2 },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'admin', label: 'Administrator', icon: UserRound },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'storage', label: 'Storage', icon: HardDrive },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'finish', label: 'Complete', icon: PartyPopper },
] as const;

const TIMEZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'UTC'];

type TestResult = { ok: boolean; message: string } | null;

export function SetupWizard() {
  const site = useSite();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { acceptSession } = useAuth();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => get<Status>('/api/v1/setup/status') });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [institution, setInstitution] = useState({
    app_name: site.app_name || 'SST Alumni Connect', institution_name: 'SST Public School Rashidabad', app_url: window.location.origin,
    contact_email: '', contact_phone: '', address: '', timezone: 'Asia/Karachi', default_language: 'en', currency: 'PKR',
  });
  const [colors, setColors] = useState<Colors>(site.branding.colors);
  const [tagline, setTagline] = useState(site.branding.tagline);
  const [logo, setLogo] = useState<MediaItem | null>(null);
  const [favicon, setFavicon] = useState<MediaItem | null>(null);
  const [admin, setAdmin] = useState({ full_name: '', email: '', password: '', confirm: '' });
  const [emailOn, setEmailOn] = useState(false);
  const [smtp, setSmtp] = useState({ host: '', port: 587, encryption: 'starttls', username: '', sender_name: 'SST Alumni Connect', sender_email: '', reply_to: '' });
  const [smtpPassword, setSmtpPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [emailTest, setEmailTest] = useState<TestResult>(null);
  const [storage, setStorage] = useState<{ provider: 'local' | 'minio' | 's3'; endpoint: string; bucket: string; region: string; secure: boolean; public_url: string; access_key: string; secret_key: string }>(
    { provider: 'local', endpoint: '', bucket: 'alumni-media', region: '', secure: true, public_url: '', access_key: '', secret_key: '' });
  const [storageTest, setStorageTest] = useState<TestResult>(null);
  const [security, setSecurity] = useState({ min_password_length: 10, mfa_policy: 'required_staff', require_email_verification: true, max_login_attempts: 5, lockout_minutes: 15 });

  useEffect(() => {
    if (status.data?.installed) nav('/login', { replace: true });
  }, [status.data, nav]);

  // Sensible defaults once the environment is known.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (!status.data || defaultsApplied.current) return;
    defaultsApplied.current = true;
    if (status.data.bundled_storage) setStorage((s) => ({ ...s, provider: 'minio' }));
    if (status.data.mail_catcher) {
      setEmailOn(true);
      setSmtp((s) => ({ ...s, host: 'mailpit', port: 1025, encryption: 'none' }));
    }
  }, [status.data]);

  // Live branding preview while choosing colours.
  const previewBrand = useMemo<Branding>(() => ({ ...site.branding, colors, tagline }), [site.branding, colors, tagline]);
  useEffect(() => applyTheme(document.documentElement, previewBrand), [previewBrand]);

  const pwOk = passwordRules({ ...site.auth, min_password_length: security.min_password_length }).every((r) => r.test(admin.password));

  const call = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fields);
      } else setError('Something went wrong. Please try again.');
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    const key = STEPS[step]!.key;
    if (key === 'welcome') {
      const ok = await call(() => api('/api/v1/setup/verify-code', { method: 'POST', body: { code }, auth: false }));
      if (!ok) return;
    }
    if (key === 'url') {
      try {
        const u = new URL(institution.app_url);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
      } catch {
        setFieldErrors({ app_url: 'Enter a full address such as https://alumni.sst.edu.pk' });
        return;
      }
    }
    if (key === 'institution' && institution.institution_name.trim().length < 2) {
      setFieldErrors({ institution_name: 'Required.' });
      return;
    }
    if (key === 'admin') {
      const errs: Record<string, string> = {};
      if (admin.full_name.trim().length < 2) errs.full_name = 'Required.';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(admin.email)) errs.email = 'Enter a valid email address.';
      if (!pwOk) errs.password = 'The password does not meet the requirements.';
      if (admin.password !== admin.confirm) errs.confirm = 'Passwords do not match.';
      setFieldErrors(errs);
      if (Object.keys(errs).length) return;
    }
    if (key === 'admin' && !smtp.sender_email) setSmtp((x) => ({ ...x, sender_email: institution.contact_email || admin.email }));
    setError(null);
    setFieldErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const upload = async (file: File, set: (m: MediaItem) => void) => {
    const fd = new FormData();
    fd.set('code', code);
    fd.set('file', file);
    const r = await call(() => api<{ data: MediaItem }>('/api/v1/setup/upload', { method: 'POST', body: fd, auth: false }));
    if (r) set(r.data);
  };

  const storagePayload = () => ({
    provider: storage.provider,
    config: storage.provider === 'local' ? {} : {
      endpoint: storage.endpoint || null, bucket: storage.bucket, region: storage.region || null, secure: storage.secure,
      public_url: storage.public_url || null, access: 'public',
    },
    access_key: storage.provider === 's3' || (storage.provider === 'minio' && storage.endpoint) ? storage.access_key : null,
    secret_key: storage.provider === 's3' || (storage.provider === 'minio' && storage.endpoint) ? storage.secret_key : null,
  });

  const smtpConfig = () => ({ ...smtp, username: smtp.username || null, reply_to: smtp.reply_to || null });

  const finish = async () => {
    const body = {
      code,
      institution: { ...institution, contact_email: institution.contact_email || null, contact_phone: institution.contact_phone || null, address: institution.address || null },
      branding: { colors, tagline, institution_logo: logo?.id ?? null, favicon: favicon?.id ?? null },
      admin: { full_name: admin.full_name, email: admin.email, password: admin.password },
      email: emailOn ? { config: smtpConfig(), password: smtpPassword || null } : null,
      storage: storagePayload(),
      security,
    };
    let failed: ApiError | null = null;
    const r = await call(() => api<{ data: { access_token: string; user: User } }>('/api/v1/setup/complete', { method: 'POST', body, auth: false })
      .catch((e) => { failed = e instanceof ApiError ? e : null; throw e; }));
    const fe = failed as ApiError | null;
    if (fe && Object.keys(fe.fields).length) {
      const first = Object.keys(fe.fields)[0]!;
      const owner: Record<string, string> = { institution: first.includes('app_url') ? 'url' : 'institution', branding: 'branding', admin: 'admin',
        email: 'email', storage: 'storage', security: 'security' };
      const target = STEPS.findIndex((st) => st.key === owner[first.split('.')[0]!]);
      if (target >= 0) {
        setStep(target);
        setFieldErrors(Object.fromEntries(Object.entries(fe.fields).map(([k, v]) => [k.split('.').at(-1)!, v])));
      }
    }
    if (r) {
      acceptSession(r.data.access_token, r.data.user);
      qc.setQueryData(['site'], (old: object | undefined) => (old ? { ...old, installed: true } : old));
      await qc.invalidateQueries({ queryKey: ['site'] });
      nav('/admin', { replace: true });
    }
  };

  if (status.isLoading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>;
  const s = status.data!;
  const cur = STEPS[step]!;
  const checksOk = s.checks ? Object.values(s.checks).every((c) => c.ok) : false;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="font-heading text-[15px] font-semibold">{institution.app_name} · Installation</span>
          <Badge tone="navy" className="border-white/20 bg-white/10">Step {step + 1} of {STEPS.length}</Badge>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[230px_1fr]">
        <ol className="hidden space-y-1 lg:block" aria-label="Setup steps">
          {STEPS.map((st, i) => (
            <li key={st.key} className={cn('flex items-center gap-3 rounded-btn px-3 py-2 text-sm',
              i === step ? 'bg-primary-soft font-medium text-primary' : i < step ? 'text-ink' : 'text-ink-muted')} aria-current={i === step ? 'step' : undefined}>
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs',
                i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-white' : 'bg-line text-ink-muted')}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>{st.label}
            </li>
          ))}
        </ol>
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft text-primary"><cur.icon className="h-5 w-5" /></span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Step {step + 1} of {STEPS.length}</p>
              <h1 className="font-heading text-xl font-semibold text-ink">{cur.label}</h1>
            </div>
          </div>
          {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

          {cur.key === 'welcome' && (
            <div className="space-y-5">
              <p className="text-[15px] leading-relaxed text-ink-muted">
                Welcome to <strong className="text-ink">{institution.app_name}</strong>. This short wizard sets up your institution, branding,
                first administrator and integrations. Everything can be changed later in <strong className="text-ink">System Configuration</strong>.
              </p>
              <Alert tone="info" title="Prove you control this server">
                Enter the one-time setup code printed in the server log. Show it with <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">docker compose logs api</code>
              </Alert>
              <Field label="Setup code" required error={fieldErrors.code}>
                {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" className="max-w-xs font-mono tracking-widest" autoFocus />}
              </Field>
            </div>
          )}

          {cur.key === 'database' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">The installer checked the services it depends on. Connection details are managed by the server and never shown here.</p>
              <ul className="divide-y divide-line rounded-card border border-line">
                {Object.entries(s.checks ?? {}).map(([k, c]) => (
                  <li key={k} className="flex items-center gap-3 px-4 py-3">
                    {c.ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-danger" />}
                    <span className="w-24 text-sm font-medium capitalize text-ink">{k}</span>
                    <span className="text-sm text-ink-muted">{c.message}</span>
                  </li>
                ))}
              </ul>
              {!checksOk && <Alert tone="warning">Some services are not reachable yet. Wait a moment and re-check.</Alert>}
              <Button variant="outline" onClick={() => status.refetch()} loading={status.isFetching}><RefreshCw />Re-check</Button>
            </div>
          )}

          {cur.key === 'url' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">The public address people use to reach the alumni platform. It is used in emails and links.</p>
              <Field label="Application URL" required hint="Include https:// — for example https://alumni.sst.edu.pk" error={fieldErrors.app_url}>
                {(id, d) => <Input id={id} aria-describedby={d} value={institution.app_url} onChange={(e) => setInstitution({ ...institution, app_url: e.target.value })} />}
              </Field>
            </div>
          )}

          {cur.key === 'institution' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Application name" required>{(id) => <Input id={id} value={institution.app_name} onChange={(e) => setInstitution({ ...institution, app_name: e.target.value })} />}</Field>
              <Field label="Institution name" required error={fieldErrors.institution_name}>{(id) => <Input id={id} value={institution.institution_name} onChange={(e) => setInstitution({ ...institution, institution_name: e.target.value })} />}</Field>
              <Field label="Contact email">{(id) => <Input id={id} type="email" value={institution.contact_email} onChange={(e) => setInstitution({ ...institution, contact_email: e.target.value })} />}</Field>
              <Field label="Contact phone">{(id) => <Input id={id} value={institution.contact_phone} onChange={(e) => setInstitution({ ...institution, contact_phone: e.target.value })} />}</Field>
              <Field label="Address" className="sm:col-span-2">{(id) => <Input id={id} value={institution.address} onChange={(e) => setInstitution({ ...institution, address: e.target.value })} />}</Field>
              <Field label="Timezone">{(id) => <Select id={id} value={institution.timezone} onChange={(e) => setInstitution({ ...institution, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Language">{(id) => <Select id={id} value={institution.default_language} onChange={(e) => setInstitution({ ...institution, default_language: e.target.value })}><option value="en">English</option><option value="ur">اردو (Urdu)</option></Select>}</Field>
                <Field label="Currency">{(id) => <Select id={id} value={institution.currency} onChange={(e) => setInstitution({ ...institution, currency: e.target.value })}>{['PKR', 'USD', 'GBP', 'AED', 'SAR', 'EUR', 'CAD'].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
              </div>
            </div>
          )}

          {cur.key === 'branding' && (
            <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <UploadBox label="Institution logo" hint="PNG or JPG, transparent background recommended" media={logo} onFile={(f) => upload(f, setLogo)} />
                  <UploadBox label="Browser icon (favicon)" hint="Square PNG or ICO" media={favicon} onFile={(f) => upload(f, setFavicon)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorInput label="Top navigation (navy)" value={colors.primary_navy} onChange={(v) => setColors({ ...colors, primary_navy: v })} />
                  <ColorInput label="Primary (buttons)" value={colors.primary} onChange={(v) => setColors({ ...colors, primary: v })} />
                  <ColorInput label="Secondary (highlights)" value={colors.secondary} onChange={(v) => setColors({ ...colors, secondary: v })} />
                  <ColorInput label="Footer / dark sections" value={colors.dark_navy} onChange={(v) => setColors({ ...colors, dark_navy: v })} />
                </div>
                <Field label="Tagline">{(id) => <Input id={id} value={tagline} onChange={(e) => setTagline(e.target.value)} />}</Field>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Live preview</p>
                <div className="overflow-hidden rounded-card border border-line">
                  <div className="flex items-center gap-2 bg-navy px-3 py-2.5 text-white">
                    {logo ? <img src={logo.url} alt="" className="h-7 w-auto" /> : <span className="h-7 w-7 rounded bg-white/15" />}
                    <span className="text-xs font-semibold">{institution.institution_name}</span>
                  </div>
                  <div className="space-y-3 bg-canvas p-4">
                    <p className="font-heading text-lg font-semibold text-ink">{institution.app_name}</p>
                    <p className="text-xs text-ink-muted">{tagline}</p>
                    <div className="flex gap-2"><Button size="sm">Primary</Button><Button size="sm" variant="secondary">Secondary</Button></div>
                  </div>
                  <div className="bg-navy-dark px-3 py-2 text-[10px] text-white/70">Footer</div>
                </div>
              </div>
            </div>
          )}

          {cur.key === 'admin' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-ink-muted sm:col-span-2">This account becomes the first Super Administrator.</p>
              <Field label="Full name" required error={fieldErrors.full_name}>{(id) => <Input id={id} autoComplete="name" value={admin.full_name} onChange={(e) => setAdmin({ ...admin, full_name: e.target.value })} />}</Field>
              <Field label="Email" required error={fieldErrors.email ?? fieldErrors['admin.email']}>{(id) => <Input id={id} type="email" autoComplete="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />}</Field>
              <Field label="Password" required error={fieldErrors.password ?? fieldErrors['admin.password']}>
                {(id) => <><PasswordInput id={id} autoComplete="new-password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /><PasswordChecklist min={security.min_password_length} password={admin.password} /></>}
              </Field>
              <Field label="Confirm password" required error={fieldErrors.confirm}>{(id) => <PasswordInput id={id} autoComplete="new-password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />}</Field>
            </div>
          )}

          {cur.key === 'email' && (
            <div className="space-y-5">
              <Switch checked={emailOn} onCheckedChange={setEmailOn} label="Send email from this platform"
                description="Needed for email verification, password resets and notifications. You can also set this up later." />
              {emailOn && (
                <>
                  {s.mail_catcher && <Alert tone="info">Development install detected: emails go to the built-in Mailpit inbox (http://localhost:8025).</Alert>}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="SMTP host" required className="sm:col-span-2" error={fieldErrors.host}>{(id) => <Input id={id} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />}</Field>
                    <Field label="Port" required>{(id) => <Input id={id} type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />}</Field>
                    <Field label="Encryption">{(id) => <Select id={id} value={smtp.encryption} onChange={(e) => setSmtp({ ...smtp, encryption: e.target.value })}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></Select>}</Field>
                    <Field label="Username">{(id) => <Input id={id} autoComplete="off" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} />}</Field>
                    <Field label="Password">{(id) => <PasswordInput id={id} autoComplete="new-password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} />}</Field>
                    <Field label="Sender name">{(id) => <Input id={id} value={smtp.sender_name} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} />}</Field>
                    <Field label="Sender email" required error={fieldErrors.sender_email}>{(id) => <Input id={id} type="email" value={smtp.sender_email} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} />}</Field>
                    <Field label="Reply-to email" error={fieldErrors.reply_to}>{(id) => <Input id={id} type="email" value={smtp.reply_to} onChange={(e) => setSmtp({ ...smtp, reply_to: e.target.value })} />}</Field>
                  </div>
                  <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-canvas/60 p-4">
                    <Field label="Send a test email to (optional)" className="min-w-[240px] flex-1">{(id) => <Input id={id} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />}</Field>
                    <Button variant="outline" loading={busy} onClick={async () => {
                      setEmailTest(null);
                      const r = await call(() => api<{ data: { ok: boolean; message: string } }>('/api/v1/setup/test-email', { method: 'POST', auth: false,
                        body: { code, config: smtpConfig(), password: smtpPassword || null, send_to: testTo || null } }));
                      if (r) setEmailTest(r.data);
                    }}>{testTo ? 'Send test' : 'Test connection'}</Button>
                  </div>
                  {emailTest && <Alert tone={emailTest.ok ? 'success' : 'danger'}>{emailTest.message}</Alert>}
                </>
              )}
            </div>
          )}

          {cur.key === 'storage' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  ['minio', 'Bundled object storage', s.bundled_storage ? 'MinIO included with this installation (recommended)' : 'Not available in this installation'],
                  ['local', 'Local disk', 'Files stored on the server volume'],
                  ['s3', 'Amazon S3 / S3-compatible', 'Your own bucket (AWS, Wasabi, DigitalOcean …)'],
                ] as const).map(([v, t, d]) => (
                  <button key={v} type="button" disabled={v === 'minio' && !s.bundled_storage}
                    onClick={() => { setStorage({ ...storage, provider: v, endpoint: '' }); setStorageTest(null); }}
                    className={cn('rounded-card border p-4 text-left transition-colors disabled:opacity-50',
                      storage.provider === v ? 'border-primary bg-primary-soft/60 ring-1 ring-primary' : 'border-line hover:border-primary/40')}>
                    <p className="text-sm font-semibold text-ink">{t}</p><p className="mt-1 text-xs text-ink-muted">{d}</p>
                  </button>
                ))}
              </div>
              {storage.provider === 's3' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Endpoint" hint="Leave empty for Amazon S3; e.g. s3.wasabisys.com">{(id, d) => <Input id={id} aria-describedby={d} value={storage.endpoint} onChange={(e) => setStorage({ ...storage, endpoint: e.target.value })} />}</Field>
                  <Field label="Region">{(id) => <Input id={id} value={storage.region} onChange={(e) => setStorage({ ...storage, region: e.target.value })} placeholder="me-central-1" />}</Field>
                  <Field label="Bucket" required>{(id) => <Input id={id} value={storage.bucket} onChange={(e) => setStorage({ ...storage, bucket: e.target.value })} />}</Field>
                  <Field label="Public URL" hint="Base address serving public files (CDN or bucket URL)">{(id, d) => <Input id={id} aria-describedby={d} value={storage.public_url} onChange={(e) => setStorage({ ...storage, public_url: e.target.value })} />}</Field>
                  <Field label="Access key" required>{(id) => <Input id={id} autoComplete="off" value={storage.access_key} onChange={(e) => setStorage({ ...storage, access_key: e.target.value })} />}</Field>
                  <Field label="Secret key" required>{(id) => <PasswordInput id={id} autoComplete="new-password" value={storage.secret_key} onChange={(e) => setStorage({ ...storage, secret_key: e.target.value })} />}</Field>
                </div>
              )}
              {storage.provider === 'minio' && (
                <Field label="Bucket name" hint="Created automatically">{(id, d) => <Input id={id} aria-describedby={d} className="max-w-xs" value={storage.bucket} onChange={(e) => setStorage({ ...storage, bucket: e.target.value })} />}</Field>
              )}
              <Button variant="outline" loading={busy} onClick={async () => {
                setStorageTest(null);
                const r = await call(() => api<{ data: { ok: boolean; message: string } }>('/api/v1/setup/test-storage', { method: 'POST', auth: false, body: { code, ...storagePayload() } }));
                if (r) setStorageTest(r.data);
              }}>Test storage</Button>
              {storageTest && <Alert tone={storageTest.ok ? 'success' : 'danger'}>{storageTest.message}</Alert>}
            </div>
          )}

          {cur.key === 'security' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Minimum password length" hint="8–128 characters">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={8} max={128} value={security.min_password_length} onChange={(e) => setSecurity({ ...security, min_password_length: Number(e.target.value) })} />}</Field>
              <Field label="Two-factor authentication">{(id) => (
                <Select id={id} value={security.mfa_policy} onChange={(e) => setSecurity({ ...security, mfa_policy: e.target.value })}>
                  <option value="optional">Optional for everyone</option>
                  <option value="required_staff">Required for administrators (recommended)</option>
                  <option value="required_all">Required for everyone</option>
                </Select>)}</Field>
              <Field label="Failed sign-ins before lockout">{(id) => <Input id={id} type="number" min={3} max={20} value={security.max_login_attempts} onChange={(e) => setSecurity({ ...security, max_login_attempts: Number(e.target.value) })} />}</Field>
              <Field label="Lockout duration (minutes)">{(id) => <Input id={id} type="number" min={1} max={1440} value={security.lockout_minutes} onChange={(e) => setSecurity({ ...security, lockout_minutes: Number(e.target.value) })} />}</Field>
              <div className="sm:col-span-2">
                <Switch checked={security.require_email_verification} onCheckedChange={(v) => setSecurity({ ...security, require_email_verification: v })}
                  label="Require email verification" description={emailOn ? 'New members confirm their email before signing in.' : 'Needs email to be configured; turn on later once email works.'} disabled={!emailOn} />
              </div>
            </div>
          )}

          {cur.key === 'finish' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">Review your choices. You can change all of them later.</p>
              <dl className="divide-y divide-line rounded-card border border-line text-sm">
                {([
                  ['Application', `${institution.app_name} — ${institution.app_url}`],
                  ['Institution', institution.institution_name],
                  ['Administrator', `${admin.full_name} <${admin.email}>`],
                  ['Email', emailOn ? `${smtp.host}:${smtp.port} as ${smtp.sender_email}` : 'Not configured'],
                  ['Storage', { local: 'Local disk', minio: `Bundled MinIO (${storage.bucket})`, s3: `S3 bucket ${storage.bucket}` }[storage.provider]],
                  ['Two-factor', { optional: 'Optional', required_staff: 'Required for administrators', required_all: 'Required for everyone' }[security.mfa_policy as 'optional']],
                ] as [string, ReactNode][]).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd className="break-words text-ink">{v}</dd></div>
                ))}
              </dl>
              {security.mfa_policy !== 'optional' && <Alert tone="info">After finishing you'll be asked to set up two-factor authentication for your administrator account.</Alert>}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
            <Button variant="ghost" onClick={() => { setStep((x) => Math.max(0, x - 1)); setError(null); }} disabled={step === 0 || busy}><ArrowLeft />Back</Button>
            {cur.key === 'finish'
              ? <Button size="lg" onClick={finish} loading={busy}><KeyRound />Complete installation</Button>
              : <Button onClick={next} loading={busy} disabled={(cur.key === 'welcome' && code.length < 5) || (cur.key === 'database' && !checksOk)}>Continue<ArrowRight /></Button>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function UploadBox({ label, hint, media, onFile }: { label: string; hint: string; media: MediaItem | null; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink">{label}</p>
      <button type="button" onClick={() => ref.current?.click()}
        className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-line bg-canvas/60 text-sm text-ink-muted hover:border-primary/50 hover:text-ink">
        {media ? <img src={media.url} alt="" className="max-h-16 max-w-[80%] object-contain" /> : <><ImagePlus className="h-6 w-6" />Upload image</>}
      </button>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon,.ico" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}

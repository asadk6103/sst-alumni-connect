import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, KeyRound, Laptop, LogOut, Phone, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useSite } from '@/lib/site';
import { cn, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, PasswordInput, Select } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { PasswordChecklist, passwordRules } from '@/pages/auth/pages';

export function AccountPage() {
  const { section = 'profile' } = useParams();
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Account settings" description="Your sign-in details and security." />
      {(user?.mfa_setup_required || user?.password_expired) && (
        <Alert tone="warning" className="mb-6" title="Action required">
          {user.password_expired ? 'Your password has expired. Choose a new one below. ' : ''}
          {user.mfa_setup_required ? 'Your organisation requires two-factor authentication for your account. Set it up below to continue.' : ''}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        <Card className="h-fit p-2">
          {[{ k: 'profile', l: 'Profile', i: UserRound, to: '/portal/account' }, { k: 'security', l: 'Security', i: ShieldCheck, to: '/portal/account/security' }].map((x) => (
            <NavLink key={x.k} to={x.to} end className={cn('flex items-center gap-2.5 rounded-btn px-3 py-2 text-sm', section === x.k ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-canvas')}>
              <x.i className="h-4 w-4" />{x.l}
            </NavLink>
          ))}
        </Card>
        <div className="min-w-0 space-y-6">{section === 'security' ? <SecuritySection /> : <ProfileSection />}</div>
      </div>
    </>
  );
}

function ProfileSection() {
  const { user, reload } = useAuth();
  const site = useSite();
  const [form, setForm] = useState({ full_name: user!.full_name, phone: user!.phone ?? '', language: user!.language ?? site.default_language });
  const save = useAction(() => api('/api/v1/auth/me', { method: 'PATCH', body: { ...form, phone: form.phone || null } }), { success: 'Profile saved.', onSuccess: () => reload() });
  const [otpOpen, setOtpOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Profile" icon={UserRound} action={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button>} />
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={user!.full_name} size={64} />
          <div>
            <p className="font-heading text-lg font-semibold text-ink">{user!.full_name}</p>
            <div className="mt-1 flex flex-wrap gap-1">{user!.roles.map((r) => <Badge key={r.key} tone="primary">{r.name}</Badge>)}</div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={save.fieldErrors.full_name}>{(id) => <Input id={id} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}</Field>
          <Field label="Email" hint={user!.email_verified ? 'Verified' : 'Not verified yet'}>{(id, d) => <Input id={id} aria-describedby={d} value={user!.email} disabled />}</Field>
          <Field label="Mobile number" error={save.fieldErrors.phone} hint={user!.phone ? (user!.phone_verified ? 'Verified' : 'Not verified') : undefined}>
            {(id, d) => (
              <div className="flex gap-2">
                <Input id={id} aria-describedby={d} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+92 300 1234567" />
                {user!.phone && !user!.phone_verified && form.phone.replace(/\s/g, '') === user!.phone && <Button variant="outline" onClick={() => setOtpOpen(true)}><Smartphone />Verify</Button>}
              </div>
            )}
          </Field>
          <Field label="Language">{(id) => <Select id={id} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="en">English</option><option value="ur">اردو (Urdu)</option></Select>}</Field>
        </div>
      </div>
      {otpOpen && <PhoneOtpDialog onClose={() => setOtpOpen(false)} />}
    </Card>
  );
}

function PhoneOtpDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const send = useAction(() => api<{ data: { sent_to: string } }>('/api/v1/auth/phone/send-code', { method: 'POST', body: {} }), { onSuccess: (r) => setSentTo(r.data.sent_to) });
  const verify = useAction(() => api('/api/v1/auth/phone/verify', { method: 'POST', body: { code } }), { success: 'Mobile number verified.', onSuccess: () => { reload(); onClose(); } });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Verify mobile number"
      footer={sentTo ? <Button onClick={() => verify.mutate(undefined, { onError: (e) => setErr(e instanceof ApiError ? e.message : null) })} loading={verify.isPending} disabled={code.length < 6}>Verify</Button>
        : <Button onClick={() => send.mutate(undefined, { onError: (e) => setErr(e instanceof ApiError ? e.message : null) })} loading={send.isPending}><Phone />Send code</Button>}>
      {err && <Alert tone="danger" className="mb-3">{err}</Alert>}
      {sentTo ? (
        <Field label={`Code sent to ${sentTo}`}>{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-[0.3em]" />}</Field>
      ) : <p className="text-sm text-ink-muted">We'll send a 6-digit code by SMS.</p>}
    </Dialog>
  );
}

type SessionRow = { id: string; user_agent: string | null; ip: string | null; created_at: string; last_used_at: string; current: boolean };

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

function SecuritySection() {
  const { user, reload, logout } = useAuth();
  const site = useSite();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const change = useAction(() => api('/api/v1/auth/password/change', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } }),
    { success: 'Password changed. Other devices were signed out.', invalidate: [['sessions']], onSuccess: () => { setPw({ current_password: '', new_password: '', confirm: '' }); reload(); } });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionRow[]>('/api/v1/auth/sessions') });
  const end = useAction((id: string) => api(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' }), { success: 'Session ended.', invalidate: [['sessions']] });
  const all = useAction(() => api('/api/v1/auth/logout-all', { method: 'POST' }), { onSuccess: async () => { await logout(); nav('/login'); } });
  const pwValid = passwordRules(site.auth).every((r) => r.test(pw.new_password)) && pw.new_password === pw.confirm && pw.current_password;
  const [mfaOpen, setMfaOpen] = useState<'enable' | 'disable' | null>(null);

  return (
    <>
      <Card>
        <CardHeader title="Two-factor authentication" icon={ShieldCheck} description="A code from an authenticator app is required when you sign in." />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          {user!.mfa_enabled ? <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />Two-factor authentication is on.</p>
            : <p className="text-sm text-ink-muted">Protect your account with Google Authenticator, Microsoft Authenticator or a similar app.</p>}
          {user!.mfa_enabled ? <Button variant="danger-outline" onClick={() => setMfaOpen('disable')}>Turn off</Button> : <Button onClick={() => setMfaOpen('enable')}><ShieldCheck />Set up</Button>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Change password" icon={KeyRound} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Current password" error={change.fieldErrors.current_password} className="sm:col-span-2">{(id) => <PasswordInput id={id} autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} className="sm:max-w-sm" />}</Field>
          <Field label="New password" error={change.fieldErrors.new_password}>{(id) => <><PasswordInput id={id} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /><PasswordChecklist password={pw.new_password} /></>}</Field>
          <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.new_password ? 'Passwords do not match.' : undefined}>{(id) => <PasswordInput id={id} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Button onClick={() => change.mutate(undefined)} loading={change.isPending} disabled={!pwValid}>Change password</Button></div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Where you're signed in" icon={Laptop}
          action={<Button variant="outline" size="sm" onClick={async () => { if (await confirm({ title: 'Sign out everywhere?', description: 'You will be signed out on all devices, including this one.', confirmLabel: 'Sign out', danger: true })) all.mutate(undefined); }}><LogOut />Sign out everywhere</Button>} />
        <ul className="divide-y divide-line">
          {sessions.data ? sessions.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">{device(s.user_agent)}{s.current && <Badge tone="success">This device</Badge>}</p>
                <p className="text-xs text-ink-muted">{s.ip ?? 'Unknown IP'} · last active {timeAgo(s.last_used_at)}</p>
              </div>
              {!s.current && <Button variant="ghost" size="sm" onClick={() => end.mutate(s.id)}>End</Button>}
            </li>
          )) : Array.from({ length: 2 }).map((_, i) => <li key={i} className="px-5 py-4"><Skeleton className="h-8" /></li>)}
        </ul>
      </Card>
      {mfaOpen === 'enable' && <MfaSetupDialog onClose={() => setMfaOpen(null)} />}
      {mfaOpen === 'disable' && <MfaDisableDialog onClose={() => setMfaOpen(null)} />}
    </>
  );
}

function MfaSetupDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useAuth();
  const setup = useQuery({ queryKey: ['mfa-setup'], queryFn: () => api<{ data: { secret: string; otpauth_uri: string } }>('/api/v1/auth/mfa/setup', { method: 'POST' }), staleTime: Infinity, gcTime: 0 });
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const enable = useAction(() => api<{ data: { recovery_codes: string[] } }>('/api/v1/auth/mfa/enable', { method: 'POST', body: { code } }), { onSuccess: (r) => { setCodes(r.data.recovery_codes); reload(); } });
  return (
    <Dialog open onOpenChange={(v) => !v && (codes ? onClose() : onClose())} title={codes ? 'Save your recovery codes' : 'Set up two-factor authentication'}
      footer={codes ? <Button onClick={onClose}>I've saved them</Button> : <Button onClick={() => enable.mutate(undefined)} loading={enable.isPending} disabled={code.length < 6}>Turn on</Button>}>
      {codes ? (
        <div className="space-y-3">
          <Alert tone="warning">Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again.</Alert>
          <ul className="grid grid-cols-2 gap-2 rounded-card bg-canvas p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : !setup.data ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted"><li>Scan the QR code with your authenticator app.</li><li>Enter the 6-digit code it shows.</li></ol>
          <div className="flex justify-center rounded-card bg-white p-4"><QRCodeSVG value={setup.data.data.otpauth_uri} size={168} /></div>
          <p className="text-center text-xs text-ink-muted">Can't scan? Enter this key: <code className="break-all font-mono text-ink">{setup.data.data.secret}</code></p>
          <Field label="6-digit code" error={enable.fieldErrors.code}>{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="text-center font-mono text-lg tracking-[0.3em]" />}</Field>
        </div>
      )}
    </Dialog>
  );
}

function MfaDisableDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useAuth();
  const [f, setF] = useState({ password: '', code: '' });
  const off = useAction(() => api('/api/v1/auth/mfa/disable', { method: 'POST', body: f }), { success: 'Two-factor authentication turned off.', onSuccess: () => { reload(); onClose(); } });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Turn off two-factor authentication"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => off.mutate(undefined)} loading={off.isPending} disabled={!f.password || f.code.length < 6}>Turn off</Button></>}>
      <div className="space-y-4">
        <Field label="Password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <Field label="Code from your authenticator app">{(id) => <Input id={id} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} inputMode="numeric" className="font-mono tracking-[0.3em]" />}</Field>
      </div>
    </Dialog>
  );
}

import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, BookOpen, Briefcase, CalendarDays, CheckCircle2, ChevronDown, Circle, Download, Flag, GraduationCap, HelpCircle, KeyRound, LifeBuoy, Mail, MapPin,
  Megaphone, MessageCircle, MessageSquareText, Monitor, Newspaper, Paperclip, Phone, Search, ShieldCheck, Smartphone, Sparkles, Ticket, UserPlus, Users,
  UsersRound, X,
} from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { useSite } from '@/lib/site';
import { cn, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/display';
import { Field, Input, PasswordInput, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm, useToast } from '@/components/ui/overlay';
import { SectionCard, fileSize } from '@/components/community';
import { PasswordChecklist, passwordRules } from '@/pages/auth/pages';
import { MfaDisableDialog, MfaSetupDialog } from './Account';
import { PrefToggle, Tips } from './Settings';

// ── Notifications ───────────────────────────────────────────────────────────
type Pref = { category: string; label: string; description: string; in_app: boolean; email: boolean; push: boolean; sms: boolean; sms_available: boolean };
type Channel = 'in_app' | 'email' | 'push' | 'sms';
const CHANNELS: [Channel, string][] = [['in_app', 'In-App'], ['email', 'Email'], ['push', 'Push'], ['sms', 'SMS']];
const GROUPS: { title: string; items: [string, typeof Bell][] }[] = [
  { title: 'Activity', items: [['messages', MessageSquareText], ['connections', UserPlus], ['mentions', MessageCircle], ['comments', MessageCircle]] },
  { title: 'Community & Engagement', items: [['community', UsersRound], ['events', CalendarDays], ['jobs', Briefcase], ['mentorship', GraduationCap]] },
  { title: 'Other', items: [['announcements', Megaphone], ['news', Newspaper], ['marketing', Sparkles], ['support', LifeBuoy], ['verification', ShieldCheck], ['achievements', Sparkles], ['donations', Users]] },
];
const ESSENTIAL = new Set(['messages', 'connections', 'events', 'mentorship', 'support', 'verification', 'announcements']);

function useNotificationPrefs() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => get<Pref[]>('/api/v1/notifications/preferences') });
  const save = useAction((rows: Pref[]) => api<{ data: Pref[] }>('/api/v1/notifications/preferences', { method: 'PUT', body: rows.map(({ category, in_app, email, push, sms }) => ({ category, in_app, email, push, sms })) }),
    { onSuccess: (r) => { qc.setQueryData(['notification-prefs'], r.data); toast.success('Notification settings saved.'); } });
  return { prefs: q.data, save };
}

export function NotificationsSection() {
  const { prefs, save } = useNotificationPrefs();
  const [channel, setChannel] = useState<Channel | 'all'>('all');
  if (!prefs) return <Skeleton className="h-96 rounded-card" />;
  const by = Object.fromEntries(prefs.map((p) => [p.category, p]));
  const update = (cat: string, ch: Channel, v: boolean) => save.mutate(prefs.map((p) => (p.category === cat ? { ...p, [ch]: v } : p)));
  const row = (cat: string, v: boolean) => save.mutate(prefs.map((p) => (p.category === cat ? { ...p, in_app: v, email: v, push: v, sms: v && p.sms_available } : p)));
  const master = (ch: Channel, v: boolean) => save.mutate(prefs.map((p) => ({ ...p, [ch]: ch === 'sms' ? v && p.sms_available : v })));
  const visible = channel === 'all' ? CHANNELS : CHANNELS.filter(([k]) => k === channel);
  return (
    <>
      <Card className="p-2"><div className="flex flex-wrap gap-1" role="tablist">{([['all', 'All channels'], ...CHANNELS] as [Channel | 'all', string][]).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={channel === k} onClick={() => setChannel(k)} className={cn('rounded-btn px-4 py-2 text-sm font-medium', channel === k ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas')}>{l}</button>))}
        {channel !== 'all' && <div className="ms-auto flex gap-1"><Button size="sm" variant="outline" onClick={() => master(channel, true)}>Turn all on</Button><Button size="sm" variant="ghost" onClick={() => master(channel, false)}>Turn all off</Button></div>}</div></Card>
      {GROUPS.map((g) => (
        <SectionCard key={g.title} title={g.title} icon={Bell}>
          <div className="hidden grid-cols-[1fr_repeat(var(--n),64px)_64px] gap-2 pb-2 text-center text-xs font-semibold uppercase text-ink-muted sm:grid" style={{ ['--n' as string]: visible.length }}>
            <span className="text-start">Notification</span>{visible.map(([, l]) => <span key={l}>{l}</span>)}<span>All</span></div>
          <ul className="divide-y divide-line">{g.items.filter(([c]) => by[c]).map(([c, I]) => { const p = by[c]!; const all = p.in_app && p.email && p.push; return (
            <li key={c} className="grid gap-2 py-3 sm:grid-cols-[1fr_repeat(var(--n),64px)_64px] sm:items-center" style={{ ['--n' as string]: visible.length }}>
              <span className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><I className="h-4 w-4" /></span>
                <span><span className="block text-sm font-medium text-ink">{p.label}</span><span className="text-xs text-ink-muted">{p.description}</span></span></span>
              {visible.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-xs text-ink-muted sm:justify-center">
                <input type="checkbox" aria-label={`${p.label}: ${l}`} disabled={k === 'sms' && !p.sms_available} checked={p[k]} onChange={(e) => update(c, k, e.target.checked)} className="h-4 w-4 accent-[rgb(var(--primary))] disabled:opacity-40" /><span className="sm:hidden">{l}</span></label>)}
              <span className="sm:text-center"><button role="switch" aria-checked={all} aria-label={`All channels for ${p.label}`} onClick={() => row(c, !all)}
                className={cn('relative inline-flex h-6 w-11 rounded-full transition', all ? 'bg-primary' : 'bg-line')}><span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', all ? 'start-[22px]' : 'start-0.5')} /></button></span>
            </li>); })}</ul>
        </SectionCard>
      ))}
      <p className="text-xs text-ink-muted">SMS is available for important updates and needs a verified mobile number. Push notifications go to the SST Alumni mobile app.</p>
    </>
  );
}

export function NotificationsAside() {
  const { prefs, save } = useNotificationPrefs();
  const { user } = useAuth();
  if (!prefs) return null;
  const allOn = prefs.every((p) => p.in_app && p.email && p.push);
  const essential = prefs.every((p) => (ESSENTIAL.has(p.category) ? p.in_app && p.email && p.push : !p.email && !p.push));
  const preset = allOn ? 'all' : essential ? 'essential' : 'custom';
  const apply = (k: 'all' | 'essential') => save.mutate(prefs.map((p) => (k === 'all' ? { ...p, in_app: true, email: p.category !== 'marketing', push: true }
    : { ...p, in_app: true, email: ESSENTIAL.has(p.category), push: ESSENTIAL.has(p.category), sms: p.sms && ESSENTIAL.has(p.category) })));
  const enabled = (ch: Channel) => prefs.some((p) => p[ch]);
  return (
    <>
      <SectionCard title="Notification Preferences" icon={Bell}>
        <div className="space-y-2" role="radiogroup">{([['all', 'All Updates (Recommended)', 'Stay on top of everything.'], ['essential', 'Essential Only', 'Messages, requests, events and account updates.'], ['custom', 'Custom', 'Your own mix of channels.']] as const).map(([k, l, d]) => (
          <label key={k} className={cn('flex cursor-pointer items-start gap-3 rounded-card border p-3', preset === k ? 'border-primary bg-primary-soft/50' : 'border-line')}>
            <input type="radio" name="preset" checked={preset === k} disabled={k === 'custom'} onChange={() => k !== 'custom' && apply(k)} className="mt-1 accent-[rgb(var(--primary))]" />
            <span><span className="block text-sm font-medium text-ink">{l}</span><span className="text-xs text-ink-muted">{d}</span></span></label>))}</div>
      </SectionCard>
      <SectionCard title="Notification Preview" icon={Smartphone}>
        <div className="flex gap-3 rounded-card border border-line p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><UserPlus className="h-4 w-4" /></span>
          <div><p className="text-sm text-ink"><strong>Ayesha Siddiqui</strong> sent you a connection request</p><p className="text-xs text-ink-muted">Just now</p></div></div>
      </SectionCard>
      <SectionCard title="Notification Summary" icon={CheckCircle2}>
        <ul className="space-y-2 text-sm">{CHANNELS.map(([k, l]) => <li key={k} className="flex items-center justify-between"><span className="text-ink">{l}</span>
          {enabled(k) ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />Enabled</span> : <span className="flex items-center gap-1 text-ink-muted"><Circle className="h-4 w-4" />Disabled</span>}</li>)}</ul>
        {!user?.phone_verified && <p className="mt-2 text-xs text-ink-muted">Verify your mobile number under Account & Privacy to receive SMS.</p>}
        <Button variant="outline" className="mt-3 w-full" onClick={() => apply('all')}>Reset to Default Settings</Button>
      </SectionCard>
    </>
  );
}

// ── Security ────────────────────────────────────────────────────────────────
type Sec = { password_changed_at: string | null; mfa_enabled: boolean; recovery_codes_left: number; login_alerts: boolean; failed_30d: number; trusted_devices: number; sessions: number;
  checks: { password: boolean; mfa: boolean; login_alerts: boolean; no_suspicious: boolean }; score: number; checked_at: string };
type Activity = { id: number; os: string; browser: string; kind: string; ip: string | null; at: string; success: boolean; reason: string | null; current: boolean };
type Trusted = { id: string; os: string; browser: string; kind: string; ip: string | null; last_used_at: string; expires_at: string };
const useSecurity = () => useQuery({ queryKey: ['security-summary'], queryFn: () => get<Sec>('/api/v1/me/security') });

export function SecuritySection() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const sec = useSecurity();
  const [dialog, setDialog] = useState<'mfa-on' | 'mfa-off' | 'codes' | 'password' | 'checkup' | null>(sp.get('password') === '1' ? 'password' : null);
  const [all, setAll] = useState(false);
  const act = useQuery({ queryKey: ['login-activity', all], queryFn: () => get<Activity[]>(`/api/v1/me/login-activity?limit=${all ? 50 : 8}`) });
  return (
    <>
      <SectionCard title="Two-Factor Authentication" icon={ShieldCheck} action={user!.mfa_enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Off</Badge>}>
        {user!.mfa_enabled ? (
          <ul className="divide-y divide-line">
            <li className="flex items-center justify-between gap-3 py-3 first:pt-0"><span className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary" /><span><span className="block text-sm font-medium text-ink">Authenticator App</span><span className="text-xs text-ink-muted">Codes from Google or Microsoft Authenticator</span></span></span>
              <span className="flex items-center gap-2"><Badge tone="success">Active</Badge><Button size="sm" variant="ghost" onClick={() => setDialog('mfa-off')}>Turn off</Button></span></li>
            <li className="flex items-center justify-between gap-3 py-3 last:pb-0"><span className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-primary" /><span><span className="block text-sm font-medium text-ink">Recovery Codes</span><span className="text-xs text-ink-muted">{sec.data?.recovery_codes_left ?? '–'} unused codes</span></span></span>
              <Button size="sm" variant="outline" onClick={() => setDialog('codes')}>View Codes</Button></li>
          </ul>
        ) : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-ink-muted">Protect your account with a code from an authenticator app when you sign in.</p><Button onClick={() => setDialog('mfa-on')}><ShieldCheck />Set up</Button></div>}
      </SectionCard>
      <SectionCard title="Password & Alerts" icon={KeyRound}>
        <div className="divide-y divide-line">
          <div className="flex items-center justify-between gap-3 pb-3"><span><span className="block text-sm font-medium text-ink">Password</span><span className="text-xs text-ink-muted">{sec.data?.password_changed_at ? `Last changed ${fmtDate(sec.data.password_changed_at)}` : 'Never changed'}</span></span>
            <Button size="sm" variant="outline" onClick={() => setDialog('password')}>Change Password</Button></div>
          <div className="py-3"><PrefToggle k="login_alerts" label="Login Alerts" description="Email me when my account is signed in from a new device." /></div>
          <div className="flex items-center justify-between gap-3 pt-3"><span><span className="block text-sm font-medium text-ink">Security Checkup</span><span className="text-xs text-ink-muted">Review your account protection in one place.</span></span>
            <Button size="sm" variant="outline" onClick={() => { sec.refetch(); setDialog('checkup'); }}>Run Checkup</Button></div>
        </div>
      </SectionCard>
      <SectionCard title="Recent Login Activity" icon={Monitor} action={<button className="text-sm font-semibold text-primary hover:underline" onClick={() => setAll(!all)}>{all ? 'Show less' : 'View All Activity →'}</button>}>
        {act.isLoading ? <Skeleton className="h-32" /> : !act.data?.length ? <p className="text-sm text-ink-muted">No sign-ins recorded yet.</p> : (
          <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-start text-xs uppercase text-ink-muted"><th className="px-4 py-2 text-start">Device / Browser</th><th className="px-2 py-2 text-start">IP address</th><th className="px-2 py-2 text-start">Date & Time</th><th className="px-4 py-2 text-start">Status</th></tr></thead>
            <tbody className="divide-y divide-line">{act.data.map((a) => <tr key={a.id}>
              <td className="px-4 py-2.5"><span className="flex items-center gap-2">{a.kind === 'mobile' ? <Smartphone className="h-4 w-4 text-ink-muted" /> : <Monitor className="h-4 w-4 text-ink-muted" />}<span><span className="block font-medium text-ink">{a.os} • {a.browser}</span></span></span></td>
              <td className="px-2 py-2.5 text-ink-muted">{a.ip ?? '—'}</td><td className="px-2 py-2.5 text-ink-muted">{fmtDateTime(a.at)}</td>
              <td className="px-4 py-2.5">{a.current ? <Badge tone="primary">Current Session</Badge> : a.success ? <Badge tone="success">Successful</Badge> : <Badge tone="danger">Failed</Badge>}</td></tr>)}</tbody></table></div>
        )}
      </SectionCard>
      {dialog === 'mfa-on' && <MfaSetupDialog onClose={() => { setDialog(null); sec.refetch(); }} />}
      {dialog === 'mfa-off' && <MfaDisableDialog onClose={() => { setDialog(null); sec.refetch(); }} />}
      {dialog === 'codes' && <RecoveryDialog onClose={() => { setDialog(null); sec.refetch(); }} />}
      {dialog === 'password' && <PasswordDialog onClose={() => { setDialog(null); sec.refetch(); }} />}
      {dialog === 'checkup' && sec.data && <CheckupDialog s={sec.data} onClose={() => setDialog(null)} onFix={(d) => setDialog(d)} />}
    </>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useAuth();
  const site = useSite();
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const change = useAction(() => api('/api/v1/auth/password/change', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } }),
    { success: 'Password changed. Other devices were signed out.', invalidate: [['sessions'], ['security-summary']], onSuccess: () => { reload(); onClose(); } });
  const ok = passwordRules(site.auth).every((r) => r.test(pw.new_password)) && pw.new_password === pw.confirm && pw.current_password;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Change password"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={change.isPending} onClick={() => change.mutate(undefined)}>Change password</Button></>}>
      <div className="space-y-4">
        <Field label="Current password" error={change.fieldErrors.current_password}>{(id) => <PasswordInput id={id} autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />}</Field>
        <Field label="New password" error={change.fieldErrors.new_password}>{(id) => <><PasswordInput id={id} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /><PasswordChecklist password={pw.new_password} /></>}</Field>
        <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.new_password ? 'Passwords do not match.' : undefined}>{(id) => <PasswordInput id={id} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function RecoveryDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const make = useAction(() => api<{ data: { codes: string[] } }>('/api/v1/me/recovery-codes', { method: 'POST', body: { password } }), { onSuccess: (r) => setCodes(r.data.codes) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Recovery codes" description={codes ? undefined : 'Recovery codes are stored securely and cannot be shown again. Create a new set — your old codes stop working.'}
      footer={codes ? <Button onClick={onClose}>I've saved them</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!password} loading={make.isPending} onClick={() => make.mutate(undefined)}>Create new codes</Button></>}>
      {codes ? <div className="space-y-3"><Alert tone="warning">Each code works once. Store them somewhere safe.</Alert>
        <ul className="grid grid-cols-2 gap-2 rounded-card bg-canvas p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <Button variant="outline" onClick={() => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([codes.join('\n')], { type: 'text/plain' })), download: 'sst-recovery-codes.txt' }); a.click(); }}><Download />Download</Button></div>
        : <Field label="Confirm with your password" error={make.fieldErrors.password}>{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>}
    </Dialog>
  );
}

function CheckupDialog({ s, onClose, onFix }: { s: Sec; onClose: () => void; onFix: (d: 'mfa-on' | 'password') => void }) {
  const items: [boolean, string, string, (() => void) | null][] = [
    [s.checks.password, 'Password is up to date', s.password_changed_at ? `Changed ${fmtDate(s.password_changed_at)}` : 'Set when you joined', s.checks.password ? null : () => onFix('password')],
    [s.checks.mfa, 'Two-factor authentication', s.mfa_enabled ? 'On' : 'Turn it on to block stolen passwords', s.checks.mfa ? null : () => onFix('mfa-on')],
    [s.checks.login_alerts, 'Login alerts', s.login_alerts ? 'You will be emailed about new devices' : 'Turn on login alerts below', null],
    [s.checks.no_suspicious, 'No suspicious activity', `${s.failed_30d} failed sign-in attempt(s) in 30 days`, null],
  ];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Security checkup — ${s.score}%`} footer={<Button onClick={onClose}>Done</Button>}>
      <ul className="space-y-3">{items.map(([ok, t, d, fix]) => <li key={t} className="flex items-start gap-3">{ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" /> : <Circle className="mt-0.5 h-5 w-5 text-warning" />}
        <span className="flex-1"><span className="block text-sm font-medium text-ink">{t}</span><span className="text-xs text-ink-muted">{d}</span></span>{fix && <Button size="sm" variant="outline" onClick={fix}>Fix</Button>}</li>)}</ul>
    </Dialog>
  );
}

export function SecurityAside() {
  const sec = useSecurity();
  const confirm = useConfirm();
  const devices = useQuery({ queryKey: ['trusted-devices'], queryFn: () => get<Trusted[]>('/api/v1/me/trusted-devices') });
  const forget = useAction((id: string | null) => api(id ? `/api/v1/me/trusted-devices/${id}` : '/api/v1/me/trusted-devices', { method: 'DELETE' }), { success: 'Done.', invalidate: [['trusted-devices'], ['security-summary']] });
  const s = sec.data;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <>
      <SectionCard title="Security Status" icon={ShieldCheck}>
        {!s ? <Skeleton className="h-32" /> : <>
          <div className="flex items-center gap-4">
            <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Security score ${s.score}%`}><circle cx="42" cy="42" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="8" />
              <circle cx="42" cy="42" r={r} fill="none" stroke={s.score >= 75 ? 'rgb(var(--success))' : 'rgb(var(--warning))'} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - s.score / 100)} transform="rotate(-90 42 42)" />
              <text x="42" y="47" textAnchor="middle" className="fill-[rgb(var(--ink))] text-[16px] font-semibold">{s.score}%</text></svg>
            <p className="text-sm font-medium text-ink">{s.score === 100 ? 'Your account is well protected' : 'A few steps will make your account safer'}</p>
          </div>
          <ul className="mt-3 space-y-2 text-sm">{([[s.checks.password, 'Strong password', s.password_changed_at ? `Updated ${fmtDate(s.password_changed_at)}` : ''], [s.checks.mfa, 'Two-Factor Authentication', ''], [s.checks.login_alerts, 'Login alerts', ''], [s.checks.no_suspicious, 'No suspicious activity', `Checked ${timeAgo(s.checked_at)}`]] as const).map(([ok, l, d]) => (
            <li key={l} className="flex items-start gap-2">{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <Circle className="mt-0.5 h-4 w-4 text-warning" />}<span><span className="text-ink">{l}</span>{d && <span className="block text-xs text-ink-muted">{d}</span>}</span></li>))}</ul></>}
      </SectionCard>
      <SectionCard title="Trusted Devices" icon={Monitor}>
        {!devices.data?.length ? <p className="text-sm text-ink-muted">Tick “Remember this device” when you enter a two-factor code to skip it on that browser for 30 days.</p> : <>
          <ul className="space-y-3">{devices.data.map((d) => <li key={d.id} className="flex items-center gap-3">{d.kind === 'mobile' ? <Smartphone className="h-5 w-5 text-ink-muted" /> : <Monitor className="h-5 w-5 text-ink-muted" />}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{d.os} • {d.browser}</span><span className="text-xs text-ink-muted">Until {fmtDate(d.expires_at)}</span></span>
            <Badge tone="success">Trusted</Badge><Button size="icon" variant="ghost" aria-label="Forget device" onClick={() => forget.mutate(d.id)}><X /></Button></li>)}</ul>
          <Button variant="outline" className="mt-3 w-full" onClick={async () => { if (await confirm({ title: 'Forget all trusted devices?', confirmLabel: 'Forget all', danger: true })) forget.mutate(null); }}>Manage Trusted Devices</Button></>}
      </SectionCard>
      <Tips title="Security Tips" items={['Use a unique password you do not use elsewhere.', 'Keep your recovery codes offline.', 'Sign out of shared computers.']} />
    </>
  );
}

// ── Help & Support ──────────────────────────────────────────────────────────
type TicketT = { id: string; number: string; category: string; priority: string; subject: string; description: string; status: string; created_at: string; updated_at: string;
  attachments: { id: string; filename: string; size: number; url: string }[]; replies?: { id: string; author: { full_name: string } | null; staff: boolean; body: string; created_at: string; attachments: { id: string; filename: string; url: string }[] }[] };
type FaqT = { id: string; question: string; answer: string; category: string };
const CATS: [string, string][] = [['account', 'Account & sign-in'], ['profile', 'Profile'], ['verification', 'Verification'], ['events', 'Events'], ['jobs', 'Jobs'], ['mentorship', 'Mentorship'], ['donations', 'Donations'], ['technical', 'Technical problem'], ['other', 'Other']];
const STATUS_TONE: Record<string, 'primary' | 'success' | 'neutral' | 'warning'> = { open: 'warning', in_progress: 'primary', resolved: 'success', closed: 'neutral' };
const statusLabel = (s: string) => s === 'in_progress' ? 'In Progress' : s[0]!.toUpperCase() + s.slice(1);

export function HelpSection() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [tile, setTile] = useState<'ticket' | 'faqs' | 'contact'>(sp.get('tab') === 'faqs' ? 'faqs' : sp.get('tab') === 'contact' ? 'contact' : 'ticket');
  const open = sp.get('ticket');
  const tiles = [{ k: 'ticket', l: 'Create a Ticket', d: 'Get help from the alumni office', icon: Ticket }, { k: 'faqs', l: 'Browse FAQs', d: 'Quick answers', icon: HelpCircle },
    { k: 'guides', l: 'Guides & Tutorials', d: 'Step-by-step help', icon: BookOpen }, { k: 'contact', l: 'Contact Us', d: 'Email, phone and address', icon: Phone }] as const;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{tiles.map((t) => (
        <button key={t.k} onClick={() => (t.k === 'guides' ? nav('/portal/resources?category=guides') : setTile(t.k))}
          className={cn('flex flex-col items-start gap-2 rounded-card border p-4 text-start', tile === t.k ? 'border-primary bg-primary-soft/60' : 'border-line bg-surface hover:border-primary/50')}>
          <span className="grid h-10 w-10 place-items-center rounded-btn bg-primary-soft text-primary"><t.icon className="h-5 w-5" /></span><span className="font-semibold text-ink">{t.l}</span><span className="text-xs text-ink-muted">{t.d}</span></button>))}</div>
      {tile === 'ticket' && <TicketForm />}
      {tile === 'faqs' && <FaqList full />}
      {tile === 'contact' && <ContactCard />}
      <MyTickets />
      {open && <TicketDialog id={open} onClose={() => { sp.delete('ticket'); setSp(sp, { replace: true }); }} />}
    </>
  );
}

function TicketForm() {
  const [f, setF] = useState({ category: '', priority: 'medium', subject: '', description: '' });
  const [files, setFiles] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const clear = () => { setF({ category: '', priority: 'medium', subject: '', description: '' }); setFiles([]); };
  const send = useAction(() => api<{ data: TicketT }>('/api/v1/support/tickets', { method: 'POST', body: { ...f, attachment_ids: files.map((x) => x.id) } }),
    { success: (r) => `Ticket ${r.data.number} submitted. We will reply by notification and email.`, invalidate: [['support-tickets']], onSuccess: clear });
  const upload = async (list: FileList | null) => {
    setBusy(true);
    try { for (const x of Array.from(list ?? []).slice(0, 5 - files.length)) { const fd = new FormData(); fd.append('file', x); const r = await api<{ data: { id: string; filename: string; size: number } }>('/api/v1/support/uploads', { method: 'POST', body: fd }); setFiles((s) => [...s, r.data]); } }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); }
  };
  const e = send.fieldErrors;
  const ok = f.category && f.subject.trim().length >= 4 && f.description.trim().length >= 10;
  return (
    <SectionCard title="Create Support Ticket" icon={Ticket}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required error={e.category}>{(id) => <Select id={id} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}><option value="">Select a category…</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <Field label="Priority" required>{(id) => <div className="relative"><Flag className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Select id={id} value={f.priority} onChange={(x) => setF({ ...f, priority: x.target.value })} className="ps-9">{['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p} className="capitalize">{p[0]!.toUpperCase() + p.slice(1)}</option>)}</Select></div>}</Field>
        <Field label="Subject" required error={e.subject} className="sm:col-span-2">{(id) => <Input id={id} value={f.subject} maxLength={200} onChange={(x) => setF({ ...f, subject: x.target.value })} placeholder="Briefly describe the problem" />}</Field>
        <Field label="Description" required error={e.description} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} maxLength={5000} onChange={(x) => setF({ ...f, description: x.target.value })} className="min-h-[120px]" placeholder="What happened? What did you expect?" />}</Field>
        <div className="sm:col-span-2"><p className="mb-1.5 text-[13px] font-medium text-ink">Attachments (optional)</p>
          <div className="flex flex-wrap items-center gap-2">{files.map((x) => <Badge key={x.id} tone="primary"><Paperclip className="h-3 w-3" />{x.filename} · {fileSize(x.size)}<button aria-label={`Remove ${x.filename}`} onClick={() => setFiles(files.filter((y) => y.id !== x.id))}><X className="h-3 w-3" /></button></Badge>)}
            {files.length < 5 && <Button size="sm" variant="outline" loading={busy} onClick={() => ref.current?.click()}><Paperclip />Upload Files</Button>}<span className="text-xs text-ink-muted">Max 10 MB per file</span></div>
          <input ref={ref} type="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={(x) => { upload(x.target.files); x.target.value = ''; }} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={clear}>Clear</Button><Button disabled={!ok} loading={send.isPending} onClick={() => send.mutate(undefined)}>Submit Ticket</Button></div>
    </SectionCard>
  );
}

function MyTickets() {
  const [sp, setSp] = useSearchParams();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['support-tickets', all], queryFn: () => get<TicketT[]>(`/api/v1/support/tickets?page_size=${all ? 50 : 5}`) });
  return (
    <SectionCard title="My Support Requests" icon={LifeBuoy} action={(q.data?.length ?? 0) >= 5 && <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setAll(!all)}>{all ? 'Show less' : 'View All Requests →'}</button>}>
      {q.isLoading ? <Skeleton className="h-24" /> : !q.data?.length ? <p className="text-sm text-ink-muted">You have no support requests.</p> : (
        <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-xs uppercase text-ink-muted"><th className="px-4 py-2 text-start">Ticket #</th><th className="px-2 py-2 text-start">Subject</th><th className="px-2 py-2 text-start">Category</th><th className="px-2 py-2 text-start">Status</th><th className="px-4 py-2 text-start">Updated</th></tr></thead>
          <tbody className="divide-y divide-line">{q.data.map((t) => <tr key={t.id} className="cursor-pointer hover:bg-canvas" onClick={() => { sp.set('ticket', t.id); setSp(sp, { replace: true }); }}>
            <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">{t.number}</td><td className="max-w-[220px] truncate px-2 py-2.5 text-ink">{t.subject}</td>
            <td className="px-2 py-2.5 text-ink-muted">{CATS.find(([k]) => k === t.category)?.[1]}</td><td className="px-2 py-2.5"><Badge tone={STATUS_TONE[t.status]}>{statusLabel(t.status)}</Badge></td>
            <td className="px-4 py-2.5 text-ink-muted">{fmtDate(t.updated_at)}</td></tr>)}</tbody></table></div>
      )}
    </SectionCard>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['support-ticket', id], queryFn: () => get<TicketT>(`/api/v1/support/tickets/${id}`) });
  const [body, setBody] = useState('');
  const reply = useAction(() => api(`/api/v1/support/tickets/${id}/replies`, { method: 'POST', body: { body } }), { invalidate: [['support-ticket', id], ['support-tickets']], onSuccess: () => setBody('') });
  const close = useAction(() => api(`/api/v1/support/tickets/${id}/close`, { method: 'POST' }), { success: 'Ticket closed.', invalidate: [['support-ticket', id], ['support-tickets']], onSuccess: onClose });
  const t = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={t ? `${t.number} · ${t.subject}` : 'Support request'}
      footer={t && t.status !== 'closed' && <><Button variant="ghost" onClick={() => close.mutate(undefined)}>Close ticket</Button><Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate(undefined)}>Send reply</Button></>}>
      {!t ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2"><Badge tone={STATUS_TONE[t.status]}>{statusLabel(t.status)}</Badge><Badge className="capitalize">{t.priority}</Badge><span className="text-xs text-ink-muted">Opened {fmtDateTime(t.created_at)}</span></div>
          <div className="rounded-card bg-canvas p-3 text-sm"><p className="whitespace-pre-line text-ink">{t.description}</p>
            {t.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-primary hover:underline"><Paperclip className="h-3.5 w-3.5" />{a.filename}</a>)}</div>
          {t.replies?.map((r) => <div key={r.id} className={cn('rounded-card p-3 text-sm', r.staff ? 'border border-primary/30 bg-primary-soft/40' : 'bg-canvas')}>
            <p className="text-xs font-semibold text-ink">{r.staff ? `${r.author?.full_name ?? 'Alumni office'} · Support team` : 'You'} <span className="font-normal text-ink-muted">· {timeAgo(r.created_at)}</span></p>
            <p className="mt-1 whitespace-pre-line text-ink">{r.body}</p></div>)}
          {t.status !== 'closed' && <Textarea aria-label="Reply" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="Add more details or reply to the support team…" />}
        </div>
      )}
    </Dialog>
  );
}

function FaqList({ full = false, limit = 5 }: { full?: boolean; limit?: number }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['faqs', dq], queryFn: () => get<FaqT[]>(`/api/v1/support/faqs${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  const items = full ? list.data ?? [] : (list.data ?? []).slice(0, limit);
  const body = (
    <>
      {full && <div className="relative mb-3"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input aria-label="Search FAQs" placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" /></div>}
      {list.isLoading ? <Skeleton className="h-24" /> : !items.length ? <p className="text-sm text-ink-muted">{dq ? 'No questions match.' : 'No FAQs yet.'}</p> : (
        <ul className="divide-y divide-line">{items.map((f) => <li key={f.id}>
          <button className="flex w-full items-center justify-between gap-2 py-3 text-start text-sm font-medium text-ink" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{f.question}<ChevronDown className={cn('h-4 w-4 shrink-0 transition', open === f.id && 'rotate-180')} /></button>
          {open === f.id && <p className="whitespace-pre-line pb-3 text-sm text-ink-muted">{f.answer}</p>}</li>)}</ul>
      )}
    </>
  );
  return full ? <SectionCard title="Frequently Asked Questions" icon={HelpCircle}>{body}</SectionCard> : body;
}

function useContact() {
  return useQuery({ queryKey: ['support-contact'], queryFn: () => get<{ email: string | null; phone: string | null; address: string | null; hours: string; name: string }>('/api/v1/support/contact'), staleTime: 300_000 });
}

function ContactCard() {
  const c = useContact().data;
  return (
    <SectionCard title="Contact Us" icon={Phone}>
      <ul className="space-y-3 text-sm">
        {c?.email && <li className="flex gap-3"><Mail className="h-5 w-5 text-primary" /><a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a></li>}
        {c?.phone && <li className="flex gap-3"><Phone className="h-5 w-5 text-primary" /><span><a href={`tel:${c.phone}`} className="font-medium text-ink">{c.phone}</a><span className="block text-xs text-ink-muted">{c.hours}</span></span></li>}
        {c?.address && <li className="flex gap-3"><MapPin className="h-5 w-5 text-primary" /><span className="text-ink">{c.address}</span></li>}
        {!c?.email && !c?.phone && !c?.address && <li className="text-ink-muted">Contact details will appear here once the alumni office adds them.</li>}
      </ul>
    </SectionCard>
  );
}

export function HelpAside() {
  const nav = useNavigate();
  const links: [string, string][] = [['Update my profile information', '/portal/profile/edit/personal'], ['Manage notification settings', '/portal/account/notifications'], ['Reset my password', '/portal/account/security?password=1'],
    ['Enable two-factor authentication', '/portal/account/security'], ['Control my privacy and visibility', '/portal/account/visibility'], ['Export my data', '/portal/account/data']];
  return (
    <>
      <SectionCard title="Quick Help" icon={LifeBuoy}>
        <ul className="space-y-1">{links.map(([l, to]) => <li key={l}><Link to={to} className="flex items-center justify-between rounded-btn px-2 py-2 text-sm text-ink hover:bg-canvas">{l}<span className="text-ink-muted">›</span></Link></li>)}</ul>
      </SectionCard>
      <SectionCard title="FAQs" icon={HelpCircle} action={<button className="text-sm font-semibold text-primary hover:underline" onClick={() => nav('/portal/account/support?tab=faqs')}>View All FAQs</button>}><FaqList /></SectionCard>
      <ContactCard />
    </>
  );
}


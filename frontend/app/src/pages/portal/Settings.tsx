import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, CheckCircle2, ChevronRight, Database, Download, Eye, Globe, HelpCircle, Info, Laptop, Languages, Lock, LogOut, Monitor, Moon,
  PauseCircle, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, Smartphone, Sun, Trash2, UserCheck, UserRound, Users, UsersRound,
} from 'lucide-react';
import { api, download, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { photoUrl, type Level, type MyProfile } from '@/lib/alumni';
import { useMemberSettings, type Prefs } from '@/lib/prefs';
import { cn, fmtDate, fmtDateTime, fmtTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, Skeleton } from '@/components/ui/display';
import { Field, Input, PasswordInput, Select, Switch } from '@/components/ui/form';
import { Dialog, useConfirm, useToast } from '@/components/ui/overlay';
import { SectionCard, useGroups } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';
import { PhoneOtpDialog, device } from './Account';
import { DeletionDialog } from './Privacy';
import { HelpSection, HelpAside, NotificationsSection, NotificationsAside, SecuritySection, SecurityAside } from './SettingsMore';

export const SECTIONS = [
  { k: 'account', l: 'Account & Privacy', icon: UserRound }, { k: 'notifications', l: 'Notifications', icon: Bell }, { k: 'security', l: 'Security', icon: ShieldCheck },
  { k: 'connections', l: 'Connections', icon: Users }, { k: 'visibility', l: 'Visibility', icon: Eye }, { k: 'communities', l: 'Communities', icon: UsersRound },
  { k: 'preferences', l: 'Preferences', icon: SlidersHorizontal }, { k: 'language', l: 'Language & Region', icon: Languages }, { k: 'data', l: 'Data & Privacy', icon: Database },
  { k: 'support', l: 'Help & Support', icon: HelpCircle },
] as const;
const ALIAS: Record<string, string> = { profile: 'account', privacy: 'data' };

/** One toggle row that saves immediately. */
export function PrefToggle({ k, label, description, invert }: { k: keyof Prefs; label: string; description?: string; invert?: boolean }) {
  const { prefs, save } = useMemberSettings();
  const toast = useToast();
  const v = Boolean(prefs?.[k]);
  return <div className="py-3 first:pt-0 last:pb-0"><Switch checked={invert ? !v : v} label={label} description={description}
    onCheckedChange={(x) => save.mutate({ [k]: invert ? !x : x } as Partial<Prefs>, { onSuccess: () => toast.success('Saved.'), onError: (e) => toast.error(e.message) })} /></div>;
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line">{children}</div>;
}

export function SettingsPage() {
  const params = useParams();
  const section = ALIAS[params.section ?? ''] ?? params.section ?? 'account';
  const { user } = useAuth();
  const { loading } = useMemberSettings();
  const current = SECTIONS.find((s) => s.k === section) ?? SECTIONS[0];
  const aside = { account: <AccountAside />, notifications: <NotificationsAside />, security: <SecurityAside />, connections: <ConnectionsAside />, visibility: <VisibilityAside />,
    communities: <CommunitiesAside />, preferences: <PreferencesAside />, language: <LanguageAside />, data: <DataAside />, support: <HelpAside /> }[current.k];
  return (
    <PortalPage aside={aside}>
      <div><h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Settings</h1>
        <p className="mt-1 text-ink-muted">Manage your account, privacy, notifications and security preferences.</p></div>
      {(user?.mfa_setup_required || user?.password_expired) && (
        <Alert tone="warning" title="Action required">{user.password_expired ? 'Your password has expired. Choose a new one under Security. ' : ''}
          {user.mfa_setup_required ? 'Your organisation requires two-factor authentication. Set it up under Security to continue.' : ''}</Alert>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <Card className="h-fit min-w-0 p-2">
          <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">{SECTIONS.map((s) => (
            <NavLink key={s.k} to={s.k === 'account' ? '/portal/account' : `/portal/account/${s.k}`} end
              className={cn('flex shrink-0 items-center gap-2.5 rounded-btn px-3 py-2.5 text-sm font-medium', current.k === s.k ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-canvas')}>
              <s.icon className="h-4 w-4" />{s.l}</NavLink>))}</nav>
        </Card>
        <div className="min-w-0 space-y-5">
          {loading ? <Skeleton className="h-96 rounded-card" /> : (
            current.k === 'account' ? <AccountSection /> : current.k === 'notifications' ? <NotificationsSection /> : current.k === 'security' ? <SecuritySection />
              : current.k === 'connections' ? <ConnectionsSection /> : current.k === 'visibility' ? <VisibilitySection /> : current.k === 'communities' ? <CommunitiesSection />
                : current.k === 'preferences' ? <PreferencesSection /> : current.k === 'language' ? <LanguageSection /> : current.k === 'data' ? <DataSection /> : <HelpSection />
          )}
        </div>
      </div>
    </PortalPage>
  );
}

// ── profile visibility helpers (AlumniProfile.visibility / privacy sections) ─
const LEVELS: [Level, string][] = [['members', 'Visible to All Alumni'], ['connections', 'My Connections Only'], ['only_me', 'Only Me']];
const VIS: ['members' | 'connections' | 'hidden', string][] = [['members', 'All Verified Alumni'], ['connections', 'My Connections'], ['hidden', 'Only Me']];

function usePrivacy() {
  const toast = useToast();
  const me = useQuery({ queryKey: ['my-profile'], queryFn: () => get<MyProfile>('/api/v1/alumni/me') });
  const save = useAction((b: { visibility?: string; sections?: Record<string, Level> }) => api('/api/v1/alumni/me/privacy', { method: 'PUT', body: {
    visibility: b.visibility ?? me.data?.privacy.visibility, sections: { ...me.data?.privacy.sections, ...b.sections } } }),
  { invalidate: [['my-profile']], onSuccess: () => toast.success('Saved.') });
  return { me: me.data, save };
}

function LevelSelect({ label, value, onChange, icon: I, options = LEVELS }: { label: string; value: string; onChange: (v: string) => void; icon?: typeof Globe; options?: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2 text-sm font-medium text-ink">{I && <I className="h-4 w-4 text-primary" />}{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-btn border border-line bg-surface px-3 text-sm text-ink sm:w-60">
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>
  );
}

// ── Account & Privacy ───────────────────────────────────────────────────────
function AccountSection() {
  const { user, reload } = useAuth();
  const nav = useNavigate();
  const { me, save } = usePrivacy();
  const { prefs, save: savePrefs } = useMemberSettings();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: user!.full_name, phone: user!.phone ?? '' });
  const [otp, setOtp] = useState(false);
  const saveAccount = useAction(() => api('/api/v1/auth/me', { method: 'PATCH', body: { full_name: form.full_name, phone: form.phone || null } }),
    { success: 'Account details saved.', onSuccess: () => { reload(); setEditing(false); } });
  const sec = me?.privacy.sections;
  const both = (a: string, b: string) => (sec?.[a] === sec?.[b] ? sec?.[a] : 'connections') ?? 'members';
  return (
    <>
      <SectionCard title="Account Information" icon={UserRound} action={!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}>
        {editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={saveAccount.fieldErrors.full_name}>{(id) => <Input id={id} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}</Field>
            <Field label="Phone number" error={saveAccount.fieldErrors.phone}>{(id) => <Input id={id} value={form.phone} placeholder="+92 300 1234567" onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
            <div className="flex gap-2 sm:col-span-2"><Button loading={saveAccount.isPending} onClick={() => saveAccount.mutate(undefined)}>Save</Button><Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
          </div>
        ) : (
          <dl className="grid gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-ink-muted">Full Name</dt><dd className="font-medium text-ink">{user!.full_name}</dd>
            <dt className="text-ink-muted">Email Address</dt><dd className="flex flex-wrap items-center gap-2 font-medium text-ink">{user!.email}{user!.email_verified && <Badge tone="success">Verified</Badge>}</dd>
            <dt className="text-ink-muted">Phone Number</dt><dd className="flex flex-wrap items-center gap-2 font-medium text-ink">{user!.phone ?? '—'}
              {user!.phone && (user!.phone_verified ? <Badge tone="success">Verified</Badge> : <Button size="sm" variant="outline" onClick={() => setOtp(true)}><Smartphone />Verify</Button>)}</dd>
            <dt className="text-ink-muted">Password</dt><dd className="flex items-center gap-3 font-medium text-ink">••••••••<button className="text-sm font-semibold text-primary hover:underline" onClick={() => nav('/portal/account/security?password=1')}>Change</button></dd>
          </dl>
        )}
      </SectionCard>
      <SectionCard title="Profile Visibility" icon={Globe}>
        {!me ? <Skeleton className="h-32" /> : <Rows>
          <LevelSelect label="Profile Visibility" icon={UserRound} value={me.privacy.visibility} options={VIS} onChange={(v) => save.mutate({ visibility: v })} />
          <LevelSelect label="Contact Information" icon={Smartphone} value={both('email', 'phone')} onChange={(v) => save.mutate({ sections: { email: v as Level, phone: v as Level } })} />
          <LevelSelect label="Education & Experience" icon={Info} value={both('education', 'career')} onChange={(v) => save.mutate({ sections: { education: v as Level, career: v as Level } })} />
          <LevelSelect label="Posts & Activity" icon={Users} value={prefs?.show_activity ? 'members' : 'only_me'} options={[['members', 'Visible to All Alumni'], ['only_me', 'Only Me']]}
            onChange={(v) => savePrefs.mutate({ show_activity: v === 'members' }, { onSuccess: () => toast.success('Saved.') })} />
        </Rows>}
      </SectionCard>
      <SectionCard title="Privacy Controls" icon={Lock}>
        <Rows>
          <div className="py-3 first:pt-0"><Switch checked={prefs?.connection_requests === 'anyone'} label="Allow connection requests from all alumni" description="When off, only your batch can send you requests."
            onCheckedChange={(v) => savePrefs.mutate({ connection_requests: v ? 'anyone' : 'batch' }, { onSuccess: () => toast.success('Saved.') })} /></div>
          <PrefToggle k="show_in_directory" label="Show me in alumni directory and search results" />
          <PrefToggle k="show_communities" label="Allow others to see my communities" />
          <PrefToggle k="msg_alumni" label="Allow messages from people who are not in my network" />
          <PrefToggle k="show_online" label="Show my online status" />
        </Rows>
      </SectionCard>
      {otp && <PhoneOtpDialog onClose={() => setOtp(false)} />}
    </>
  );
}

type SessionRow = { id: string; user_agent: string | null; ip: string | null; created_at: string; last_used_at: string; current: boolean };

function AccountAside() {
  const { user } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [deact, setDeact] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionRow[]>('/api/v1/auth/sessions') });
  const end = useAction((id: string) => api(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' }), { success: 'Session ended.', invalidate: [['sessions']] });
  const others = (sessions.data ?? []).filter((s) => !s.current);
  return (
    <>
      <SectionCard title="Account Security" icon={ShieldCheck}>
        <ul className="divide-y divide-line text-sm">
          <li><button onClick={() => nav('/portal/account/security')} className="flex w-full items-center justify-between py-2.5"><span className="font-medium text-ink">Two-Factor Authentication</span>
            <span className="flex items-center gap-1">{user!.mfa_enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Off</Badge>}<ChevronRight className="h-4 w-4 text-ink-muted" /></span></button></li>
          <li className="py-2.5"><PrefToggle k="login_alerts" label="Login Alerts" /></li>
          <li><button onClick={() => nav('/portal/account/security?password=1')} className="flex w-full items-center justify-between py-2.5 font-medium text-ink">Change Password<ChevronRight className="h-4 w-4 text-ink-muted" /></button></li>
        </ul>
      </SectionCard>
      <SectionCard title="Active Sessions" icon={Laptop}>
        {sessions.isLoading ? <Skeleton className="h-20" /> : <ul className="space-y-3">{(sessions.data ?? []).slice(0, 4).map((s) => (
          <li key={s.id} className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary">{/Android|iPhone|Mobile/.test(s.user_agent ?? '') ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{device(s.user_agent)}</span><span className="text-xs text-ink-muted">{s.current ? 'This device' : `Last active ${timeAgo(s.last_used_at)}`}{s.ip ? ` · ${s.ip}` : ''}</span></span>
            {s.current ? <Badge tone="success">Current</Badge> : <Button size="sm" variant="ghost" onClick={() => end.mutate(s.id)}>End</Button>}</li>))}</ul>}
        {others.length > 0 && <Button variant="outline" className="mt-3 w-full" onClick={async () => { if (await confirm({ title: 'Sign out of all other sessions?', confirmLabel: 'Sign out', danger: true })) for (const s of others) await end.mutateAsync(s.id); }}><LogOut />Sign Out of All Other Sessions</Button>}
      </SectionCard>
      <SectionCard title="Account Actions" icon={SettingsIcon}>
        <ul className="divide-y divide-line text-sm">
          <li><button onClick={() => download('/api/v1/account/export', 'my-data.json')} className="flex w-full items-center justify-between py-2.5 font-medium text-ink"><span className="flex items-center gap-2"><Download className="h-4 w-4" />Download My Data</span><ChevronRight className="h-4 w-4 text-ink-muted" /></button></li>
          <li><button onClick={() => setDeact(true)} className="flex w-full items-center justify-between py-2.5 font-medium text-ink"><span className="flex items-center gap-2"><PauseCircle className="h-4 w-4" />Deactivate Account</span><ChevronRight className="h-4 w-4 text-ink-muted" /></button></li>
          <li><button onClick={() => nav('/portal/account/data?delete=1')} className="flex w-full items-center justify-between py-2.5 font-medium text-danger"><span className="flex items-center gap-2"><Trash2 className="h-4 w-4" />Delete Account</span><ChevronRight className="h-4 w-4" /></button></li>
        </ul>
      </SectionCard>
      {deact && <DeactivateDialog onClose={() => setDeact(false)} />}
    </>
  );
}

export function DeactivateDialog({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const go = useAction(() => api('/api/v1/me/deactivate', { method: 'POST', body: { password } }), { onSuccess: async () => { await logout().catch(() => undefined); nav('/'); } });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Deactivate your account" description="Your profile is hidden and you are signed out everywhere. Sign in again any time to reactivate it."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!password} loading={go.isPending} onClick={() => go.mutate(undefined)}><PauseCircle />Deactivate</Button></>}>
      <Field label="Confirm with your password" error={go.fieldErrors.password}>{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
    </Dialog>
  );
}

// ── Connections ─────────────────────────────────────────────────────────────
function ConnectionsSection() {
  const { prefs, save } = useMemberSettings();
  const toast = useToast();
  const opts: [Prefs['connection_requests'], string, string][] = [['anyone', 'Anyone in the alumni community', 'Every verified alumnus can send you a request.'],
    ['batch', 'Alumni from my batch only', 'Only your classmates can send you requests.'], ['batch_range', 'My batch and related batches (±5 years)', 'Classmates and alumni who graduated within five years of you.'],
    ['none', 'Only people I send a request to', 'Nobody can send you requests; you can still connect with others.']];
  return (
    <>
      <SectionCard title="Connection Requests" icon={UserCheck}>
        <p className="mb-3 text-sm text-ink-muted">Who can send you connection requests?</p>
        <div className="space-y-2" role="radiogroup">{opts.map(([k, l, d]) => (
          <label key={k} className={cn('flex cursor-pointer items-start gap-3 rounded-card border p-3', prefs?.connection_requests === k ? 'border-primary bg-primary-soft/50' : 'border-line')}>
            <input type="radio" name="conn" checked={prefs?.connection_requests === k} onChange={() => save.mutate({ connection_requests: k }, { onSuccess: () => toast.success('Saved.') })} className="mt-1 accent-[rgb(var(--primary))]" />
            <span><span className="block text-sm font-medium text-ink">{l}</span><span className="text-xs text-ink-muted">{d}</span></span></label>))}</div>
      </SectionCard>
      <SectionCard title="Messaging Permissions" icon={Users}>
        <Rows>
          <div className="py-3 first:pt-0"><Switch checked disabled label="My connections" description="Your connections can always message you." onCheckedChange={() => undefined} /></div>
          <PrefToggle k="msg_batchmates" label="My batchmates" description="Verified alumni from your batch can message you without a connection." />
          <PrefToggle k="msg_alumni" label="Other alumni in the portal" description="Any verified alumnus can start a conversation with you." />
          <PrefToggle k="msg_community" label="Allow messages from community members" description="Members of communities you belong to can message you." />
        </Rows>
      </SectionCard>
      <SectionCard title="Network Visibility" icon={Eye}><Rows>
        <PrefToggle k="show_connections" label="Show my connections on my profile" />
        <PrefToggle k="show_mutual" label="Show mutual connections" description="Others see how many connections you have in common." />
      </Rows></SectionCard>
      <SectionCard title="Connection Preferences" icon={SlidersHorizontal}><Rows>
        <PrefToggle k="allow_follow" label="Allow follow requests" description="Let alumni follow your public posts without a connection." />
        <PrefToggle k="suggest_me" label="Suggest my profile to other alumni" description="Appear in “People You May Know”." />
      </Rows></SectionCard>
    </>
  );
}

type Blocked = { id: string; full_name: string; photo: MyProfile['photo'] };

function ConnectionsAside() {
  const summary = useQuery({ queryKey: ['network-summary'], queryFn: () => get<{ network: { connections: number; received: number; sent: number } }>('/api/v1/alumni/network/summary') });
  const pending = useQuery({ queryKey: ['connections', 'received', 'settings'], queryFn: () => get<{ id: string; request_id: string; full_name: string; photo: MyProfile['photo']; batch: string | null }[]>('/api/v1/alumni/connections?type=received&page_size=3') });
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => get<Blocked[]>('/api/v1/messages/blocks') });
  const respond = useAction(({ id, a }: { id: string; a: 'accept' | 'decline' }) => api(`/api/v1/alumni/connections/${id}/${a}`, { method: 'POST' }), { success: 'Done.', invalidate: [['connections'], ['network-summary']] });
  const unblock = useAction((id: string) => api(`/api/v1/messages/blocks/${id}`, { method: 'DELETE' }), { success: 'Unblocked.', invalidate: [['blocks']] });
  const n = summary.data?.network;
  return (
    <>
      <SectionCard title="My Network" icon={Users}>
        <div className="grid grid-cols-3 gap-2 text-center">{[['Connections', n?.connections], ['Pending', n?.received], ['Sent', n?.sent]].map(([l, v]) => (
          <div key={l as string} className="rounded-card bg-canvas py-2"><p className="font-heading text-xl font-semibold text-ink">{v ?? '–'}</p><p className="text-xs text-ink-muted">{l}</p></div>))}</div>
        <Link to="/portal/network" className="mt-3 block text-sm font-semibold text-primary hover:underline">Manage My Network →</Link>
      </SectionCard>
      {!!pending.data?.length && <SectionCard title="Pending Requests" icon={UserCheck}>
        <ul className="space-y-3">{pending.data.map((p) => <li key={p.id} className="flex items-center gap-3"><Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={36} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.full_name}</span>
          <Button size="sm" onClick={() => respond.mutate({ id: p.request_id, a: 'accept' })}>Accept</Button>
          <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: p.request_id, a: 'decline' })}>Decline</Button></li>)}</ul>
      </SectionCard>}
      <SectionCard title="Blocked Users" icon={Lock}>
        {!blocks.data?.length ? <p className="text-sm text-ink-muted">You have not blocked anyone.</p> : <>
          <p className="mb-2 text-sm text-ink-muted">You have {blocks.data.length} blocked user{blocks.data.length === 1 ? '' : 's'}.</p>
          <ul className="space-y-2">{blocks.data.map((b) => <li key={b.id} className="flex items-center gap-3"><Avatar name={b.full_name} src={photoUrl(b.photo, 64)} size={32} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{b.full_name}</span><Button size="sm" variant="ghost" onClick={() => unblock.mutate(b.id)}>Unblock</Button></li>)}</ul></>}
      </SectionCard>
      <Tips items={['Accept requests only from people you recognise.', 'Batch-only requests keep your network close to your classmates.', 'You can block a member from any chat.']} />
    </>
  );
}

export function Tips({ items, title = 'Tips' }: { items: string[]; title?: string }) {
  return <SectionCard title={title} icon={Info}><ul className="space-y-2">{items.map((t) => <li key={t} className="flex gap-2 text-sm text-ink"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />{t}</li>)}</ul></SectionCard>;
}

// ── Visibility ──────────────────────────────────────────────────────────────
function VisibilitySection() {
  const { me, save } = usePrivacy();
  if (!me) return <Skeleton className="h-80 rounded-card" />;
  const s = me.privacy.sections;
  const rows: [string, string][] = [['education', 'Education'], ['career', 'Experience'], ['phone', 'Contact Information'], ['email', 'Email Address'], ['birthday', 'Date of Birth'], ['location', 'Location (City)']];
  return (
    <>
      <SectionCard title="Profile Visibility" icon={UserRound}>
        <Rows>
          <LevelSelect label="Who can view my profile" value={me.privacy.visibility} options={VIS} onChange={(v) => save.mutate({ visibility: v })} />
          <PrefToggle k="show_in_directory" label="Show my profile in alumni directory" />
          <PrefToggle k="appear_in_search" label="Allow my profile to appear in search results" />
        </Rows>
      </SectionCard>
      <SectionCard title="Profile Information Visibility" icon={Info}>
        <Rows>{rows.map(([k, l]) => <LevelSelect key={k} label={l} value={s[k] ?? 'members'} options={LEVELS.map(([a, b]) => [a, b === 'Visible to All Alumni' ? 'All Verified Alumni' : b])} onChange={(v) => save.mutate({ sections: { [k]: v as Level } })} />)}</Rows>
      </SectionCard>
      <SectionCard title="Activity & Presence" icon={Eye}><Rows>
        <PrefToggle k="show_online" label="Show my online status" />
        <PrefToggle k="show_activity" label="Show my activities (posts, likes, comments)" />
      </Rows></SectionCard>
      <SectionCard title="Other Visibility Controls" icon={SlidersHorizontal}><Rows>
        <PrefToggle k="show_connections" label="Allow others to view my connections" />
        <PrefToggle k="show_mutual" label="Show mutual connections to others" />
        <PrefToggle k="suggest_me" label="Allow my profile in “People You May Know”" />
      </Rows></SectionCard>
    </>
  );
}

function VisibilityAside() {
  const { me } = usePrivacy();
  const { prefs } = useMemberSettings();
  const [as, setAs] = useState<'members' | 'connections' | 'public'>('members');
  if (!me) return <Skeleton className="h-60 rounded-card" />;
  const s = me.privacy.sections;
  const sees = (level?: string) => as !== 'public' && (level === 'members' || (level === 'connections' && as === 'connections'));
  const profileVisible = as !== 'public' && (me.privacy.visibility === 'members' || (me.privacy.visibility === 'connections' && as === 'connections'));
  const pill = (l?: string) => l === 'members' ? <Badge tone="success">All Verified Alumni</Badge> : l === 'connections' ? <Badge tone="primary">My Connections Only</Badge> : <Badge>Only Me</Badge>;
  const job = [me.designation, me.organization].filter(Boolean).join(' at ');
  return (
    <>
      <SectionCard title="Profile Preview" icon={Eye}>
        <div className="mb-3 flex gap-1 rounded-btn bg-canvas p-1">{([['members', 'As Alumni'], ['connections', 'As Connection'], ['public', 'As Public']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAs(k)} className={cn('flex-1 rounded-btn px-2 py-1.5 text-xs font-medium', as === k ? 'bg-surface text-primary shadow-card' : 'text-ink-muted')}>{l}</button>))}</div>
        <div className="overflow-hidden rounded-card border border-line">
          <div className="h-16 bg-gradient-to-r from-navy to-primary" />
          <div className="px-4 pb-4"><div className="-mt-7"><Avatar name={me.full_name} src={photoUrl(me.photo, 120)} size={56} className="ring-4 ring-surface" /></div>
            {profileVisible ? <>
              <p className="mt-1 font-semibold text-ink">{me.full_name}</p><p className="text-xs text-ink-muted">{me.class_name ?? (me.graduation_year ? `Class of ${me.graduation_year}` : '')}</p>
              {sees(s.career) && job && <p className="mt-1 text-sm text-ink">{job}</p>}
              {sees(s.location) && me.city && <p className="text-xs text-ink-muted">{[me.city, me.country].filter(Boolean).join(', ')}</p>}
              <Link to="/portal/profile" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">View Full Profile ↗</Link></>
              : <p className="mt-2 text-sm text-ink-muted">{as === 'public' ? 'Your profile is never shown outside the portal.' : 'This viewer cannot see your profile.'}</p>}
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Visibility Summary" icon={ShieldCheck}>
        <dl className="space-y-2 text-sm">{[['Profile', me.privacy.visibility === 'hidden' ? 'only_me' : me.privacy.visibility], ['Education', s.education], ['Experience', s.career], ['Contact', s.phone], ['Email', s.email], ['Date of birth', s.birthday], ['Location', s.location]].map(([l, v]) => (
          <div key={l} className="flex items-center justify-between gap-2"><dt className="text-ink-muted">{l}</dt><dd>{pill(v)}</dd></div>))}
          <div className="flex items-center justify-between gap-2"><dt className="text-ink-muted">Online status</dt><dd>{prefs?.show_online ? <Badge tone="success">Visible to Others</Badge> : <Badge>Hidden</Badge>}</dd></div></dl>
      </SectionCard>
      <Tips title="Visibility Tips" items={['Keep your email and phone for connections only.', 'A visible profile helps classmates find you.', 'Hiding your online status also hides it in chats.']} />
    </>
  );
}

// ── Communities ─────────────────────────────────────────────────────────────
function CommunitiesSection() {
  const { prefs, save } = useMemberSettings();
  const toast = useToast();
  const mine = useGroups('mine');
  const [level, setLevel] = useState<'all' | 'highlights' | 'off' | ''>('');
  const apply = useAction(async (l: 'all' | 'highlights' | 'off') => {
    for (const g of (mine.data ?? []).filter((x) => x.membership?.status === 'active')) await api(`/api/v1/community/groups/${g.id}/notify`, { method: 'POST', body: { level: l } });
  }, { success: 'Notification level applied to all your communities.', invalidate: [['groups']] });
  return (
    <>
      <SectionCard title="Community Membership & Visibility" icon={UsersRound}><Rows>
        <PrefToggle k="show_communities" label="Show my community memberships on my profile" />
        <PrefToggle k="show_activity" label="Allow other alumni to see my community activity" />
        <PrefToggle k="suggest_me" label="Allow communities to suggest me as a member" />
      </Rows></SectionCard>
      <SectionCard title="Community Invitations" icon={UserCheck}>
        <LevelSelect label="Who can invite me to communities?" value={prefs?.group_invites ?? 'connections'} options={[['connections', 'My Connections'], ['none', 'No one']]}
          onChange={(v) => save.mutate({ group_invites: v as Prefs['group_invites'] }, { onSuccess: () => toast.success('Saved.') })} />
      </SectionCard>
      <SectionCard title="Community Notifications" icon={Bell}>
        <p className="mb-3 text-sm text-ink-muted">Apply one notification level to every community you belong to. You can still change single communities from their page.</p>
        <div className="space-y-2" role="radiogroup">{([['all', 'All Community Updates', 'Every new post'], ['highlights', 'Important Only (Recommended)', 'Announcements and events'], ['off', 'Off', 'No community notifications']] as const).map(([k, l, d]) => (
          <label key={k} className={cn('flex cursor-pointer items-start gap-3 rounded-card border p-3', level === k ? 'border-primary bg-primary-soft/50' : 'border-line')}>
            <input type="radio" name="cn" checked={level === k} onChange={() => { setLevel(k); apply.mutate(k); }} className="mt-1 accent-[rgb(var(--primary))]" />
            <span><span className="block text-sm font-medium text-ink">{l}</span><span className="text-xs text-ink-muted">{d}</span></span></label>))}</div>
      </SectionCard>
    </>
  );
}

function CommunitiesAside() {
  const mine = useGroups('mine');
  const active = (mine.data ?? []).filter((g) => g.membership?.status === 'active');
  return (
    <>
      <SectionCard title="My Communities" icon={UsersRound}>
        <p className="mb-3 text-sm text-ink-muted">You are a member of {active.length} communit{active.length === 1 ? 'y' : 'ies'}.</p>
        <ul className="space-y-3">{active.slice(0, 6).map((g) => <li key={g.id}><Link to={`/portal/community/groups/${g.id}`} className="flex items-center gap-3 hover:text-primary">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><UsersRound className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{g.name}</span><span className="text-xs text-ink-muted">{g.member_count} members</span></span>
          <Badge tone="primary" className="capitalize">{g.membership?.role === 'owner' ? 'Admin' : g.membership?.role}</Badge></Link></li>)}</ul>
      </SectionCard>
      <Tips title="Community Tips" items={['“Important only” keeps you informed without noise.', 'Only your connections can invite you to communities.', 'Report inappropriate posts from the post menu.']} />
    </>
  );
}

// ── Preferences ─────────────────────────────────────────────────────────────
function Checks({ k, options }: { k: 'feed_sources' | 'feed_types'; options: [string, string][] }) {
  const { prefs, save } = useMemberSettings();
  const v = prefs?.[k] ?? [];
  return <div className="flex flex-wrap gap-x-5 gap-y-2">{options.map(([o, l]) => <label key={o} className="flex items-center gap-2 text-sm text-ink">
    <input type="checkbox" checked={v.includes(o)} onChange={(e) => save.mutate({ [k]: e.target.checked ? [...v, o] : v.filter((x) => x !== o) } as Partial<Prefs>)} className="h-4 w-4 accent-[rgb(var(--primary))]" />{l}</label>)}</div>;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, typeof Sun?][]; onChange: (v: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex rounded-btn border border-line p-1">{options.map(([k, l, I]) => (
    <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={cn('flex items-center gap-1.5 rounded-btn px-3 py-1.5 text-sm font-medium', value === k ? 'bg-primary text-white' : 'text-ink hover:bg-canvas')}>{I && <I className="h-4 w-4" />}{l}</button>))}</div>;
}

function PreferencesSection() {
  const { prefs, save } = useMemberSettings();
  const toast = useToast();
  const reset = useAction(() => api('/api/v1/me/settings/reset', { method: 'POST', body: ['feed_sources', 'feed_types', 'feed_order', 'hide_not_interested', 'autoplay', 'read_receipts', 'typing', 'theme', 'font_size', 'compact', 'open_links_new_tab', 'show_suggestions', 'weekly_digest'] }),
    { success: 'Preferences reset.', invalidate: [['member-settings']] });
  if (!prefs) return null;
  return (
    <>
      <SectionCard title="Feed & Content Preferences" icon={SlidersHorizontal}>
        <div className="space-y-4">
          <div><p className="mb-2 text-sm font-medium text-ink">Show me content from</p><Checks k="feed_sources" options={[['network', 'My Network'], ['communities', 'My Communities'], ['batch', 'My Batch'], ['all', 'All Alumni']]} /></div>
          <div><p className="mb-2 text-sm font-medium text-ink">Content types to show</p><Checks k="feed_types" options={[['posts', 'Posts'], ['events', 'Events'], ['jobs', 'Jobs'], ['announcements', 'Announcements']]} /></div>
          <LevelSelect label="Feed order" value={prefs.feed_order} options={[['relevant', 'Most Relevant (Recommended)'], ['latest', 'Latest']]} onChange={(v) => save.mutate({ feed_order: v as Prefs['feed_order'] }, { onSuccess: () => toast.success('Saved.') })} />
          <PrefToggle k="hide_not_interested" label="Hide content I'm not interested in" description="Posts you hid with “Not interested” stay out of your feed." />
        </div>
      </SectionCard>
      <SectionCard title="Content & Interaction" icon={Users}><Rows>
        <PrefToggle k="autoplay" label="Auto-play videos in feed" description="Videos start muted." />
        <PrefToggle k="read_receipts" label="Show read receipts in messages" description="When off, others never see that you read their messages." />
        <PrefToggle k="typing" label="Show typing indicator in messages" />
      </Rows></SectionCard>
      <SectionCard title="Display & Theme" icon={Sun}>
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-medium text-ink">Appearance</span>
            <Segmented label="Appearance" value={prefs.theme} options={[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]]} onChange={(v) => save.mutate({ theme: v })} /></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-medium text-ink">Font size</span>
            <Segmented label="Font size" value={prefs.font_size} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={(v) => save.mutate({ font_size: v })} /></div>
          <PrefToggle k="compact" label="Compact view" description="Tighter spacing to see more on screen." />
        </div>
      </SectionCard>
      <SectionCard title="General Preferences" icon={SettingsIcon}><Rows>
        <PrefToggle k="open_links_new_tab" label="Open links in a new tab" />
        <PrefToggle k="show_suggestions" label="Show profile suggestions (People You May Know)" />
        <PrefToggle k="weekly_digest" label="Receive weekly email digest" description="A Monday summary of new posts, events and jobs." />
      </Rows>
        <Button variant="outline" className="mt-4" loading={reset.isPending} onClick={() => reset.mutate(undefined)}>Reset Preferences</Button>
      </SectionCard>
    </>
  );
}

function PreferencesAside() {
  const { prefs } = useMemberSettings();
  const { lang, languages, setLanguage } = useI18n();
  const { save } = useMemberSettings();
  if (!prefs) return null;
  return (
    <>
      <SectionCard title="Feed Preview" icon={Eye}>
        <div className="rounded-card border border-line p-3"><div className="flex items-center gap-2"><Avatar name="SST Alumni Office" size={32} /><div><p className="text-sm font-semibold text-ink">SST Alumni Office</p><p className="text-xs text-ink-muted">{fmtDateTime(new Date().toISOString())}</p></div></div>
          <p className="mt-2 text-sm text-ink">Registrations for the annual reunion are now open. See you there!</p></div>
      </SectionCard>
      <SectionCard title="Language & Region" icon={Languages}>
        <div className="space-y-3">
          <Field label="Language">{(id) => <Select id={id} value={lang} onChange={(e) => setLanguage(e.target.value)}>{(languages.length ? languages : [{ code: 'en', name: 'English', native_name: 'English', rtl: false }]).map((l) => <option key={l.code} value={l.code}>{l.native_name}</option>)}</Select>}</Field>
          <Field label="Timezone">{(id) => <Select id={id} value={prefs.timezone} onChange={(e) => save.mutate({ timezone: e.target.value })}>{TIMEZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        </div>
      </SectionCard>
      <SectionCard title="Experience Summary" icon={CheckCircle2}>
        <dl className="space-y-2 text-sm">{[['Feed order', prefs.feed_order === 'latest' ? 'Latest' : 'Most Relevant'], ['Appearance', prefs.theme], ['Font size', prefs.font_size], ['Weekly digest', prefs.weekly_digest ? 'On' : 'Off']].map(([l, v]) => (
          <div key={l} className="flex justify-between"><dt className="text-ink-muted">{l}</dt><dd><Badge tone="primary" className="capitalize">{v}</Badge></dd></div>))}</dl>
      </SectionCard>
    </>
  );
}

// ── Language & Region ───────────────────────────────────────────────────────
export const TIMEZONES: [string, string][] = [['Asia/Karachi', '(GMT+05:00) Pakistan Standard Time (PKT)'], ['Asia/Dubai', '(GMT+04:00) Gulf Standard Time'], ['Asia/Riyadh', '(GMT+03:00) Arabia Standard Time'],
  ['Europe/London', '(GMT+00:00) London'], ['Europe/Berlin', '(GMT+01:00) Central European Time'], ['America/New_York', '(GMT−05:00) Eastern Time (US & Canada)'],
  ['America/Chicago', '(GMT−06:00) Central Time'], ['America/Los_Angeles', '(GMT−08:00) Pacific Time'], ['America/Toronto', '(GMT−05:00) Toronto'], ['Asia/Kolkata', '(GMT+05:30) India Standard Time'],
  ['Asia/Kuala_Lumpur', '(GMT+08:00) Malaysia Time'], ['Australia/Sydney', '(GMT+10:00) Sydney'], ['UTC', '(GMT+00:00) Coordinated Universal Time']];
const DATE_FORMATS: [string, string][] = [['DD MMM, YYYY', 'DD MMM, YYYY (e.g., 25 Nov, 2026)'], ['MMM DD, YYYY', 'MMM DD, YYYY (e.g., Nov 25, 2026)'], ['DD/MM/YYYY', 'DD/MM/YYYY (e.g., 25/11/2026)'], ['YYYY-MM-DD', 'YYYY-MM-DD (e.g., 2026-11-25)']];

function LanguageSection() {
  const { prefs, save } = useMemberSettings();
  const { lang, languages, setLanguage } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ region_country: prefs?.region_country ?? '', region_city: prefs?.region_city ?? '', date_format: prefs?.date_format ?? 'DD MMM, YYYY', time_format: prefs?.time_format ?? '12', timezone: prefs?.timezone ?? 'Asia/Karachi' });
  useEffect(() => { if (prefs) setF({ region_country: prefs.region_country ?? '', region_city: prefs.region_city ?? '', date_format: prefs.date_format, time_format: prefs.time_format, timezone: prefs.timezone }); }, [prefs]);
  const list = languages.length ? languages : [{ code: 'en', name: 'English', native_name: 'English', rtl: false }];
  return (
    <>
      <SectionCard title="Language" icon={Languages}>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">{list.map((l) => (
          <button key={l.code} role="radio" aria-checked={lang === l.code} onClick={() => setLanguage(l.code)}
            className={cn('rounded-card border p-4 text-start', lang === l.code ? 'border-primary bg-primary-soft/50' : 'border-line hover:border-primary/50')}>
            <span className="block font-semibold text-ink">{l.native_name}</span><span className="text-sm text-ink-muted">{l.name}</span></button>))}</div>
      </SectionCard>
      <SectionCard title="Region & Location" icon={Globe}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country / Region">{(id) => <Input id={id} value={f.region_country} maxLength={100} onChange={(e) => setF({ ...f, region_country: e.target.value })} placeholder="Pakistan" />}</Field>
          <Field label="City">{(id) => <Input id={id} value={f.region_city} maxLength={100} onChange={(e) => setF({ ...f, region_city: e.target.value })} placeholder="Lahore" />}</Field>
        </div>
      </SectionCard>
      <SectionCard title="Date & Time" icon={Info}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date format">{(id) => <Select id={id} value={f.date_format} onChange={(e) => setF({ ...f, date_format: e.target.value })}>{DATE_FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <div><p className="mb-1.5 text-[13px] font-medium text-ink">Time format</p><div className="flex gap-4">{(['12', '24'] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="tf" checked={f.time_format === k} onChange={() => setF({ ...f, time_format: k })} className="accent-[rgb(var(--primary))]" />{k}-hour</label>)}</div></div>
          <Field label="Timezone" className="sm:col-span-2">{(id) => <Select id={id} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{TIMEZONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        </div>
        <div className="mt-5 flex gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={() => save.mutate({ date_format: 'DD MMM, YYYY', time_format: '12', timezone: 'Asia/Karachi', region_country: null, region_city: null }, { onSuccess: () => toast.success('Reset to default.') })}>Reset to Default</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ ...f, region_country: f.region_country || null, region_city: f.region_city || null }, { onSuccess: () => toast.success('Settings saved.'), onError: (e) => toast.error(e.message) })}>Save Changes</Button>
        </div>
      </SectionCard>
    </>
  );
}

function LanguageAside() {
  const { prefs } = useMemberSettings();
  const { lang, languages } = useI18n();
  const now = new Date().toISOString();
  return (
    <>
      <SectionCard title="Preview" icon={Eye}>
        <div className="rounded-card border border-line p-3 text-sm"><p className="font-semibold text-ink">Alumni Reunion 2026</p>
          <p className="text-ink-muted">{fmtDate(now)} · {fmtTime(now)}</p><p className="text-ink-muted">{[prefs?.region_city, prefs?.region_country].filter(Boolean).join(', ') || 'SST Campus'}</p></div>
      </SectionCard>
      <SectionCard title="Your Settings Summary" icon={CheckCircle2}>
        <dl className="space-y-2 text-sm">{[['Language', languages.find((l) => l.code === lang)?.name ?? lang], ['Date format', prefs?.date_format], ['Time format', `${prefs?.time_format}-hour`], ['Timezone', prefs?.timezone]].map(([l, v]) => (
          <div key={l} className="flex justify-between gap-2"><dt className="text-ink-muted">{l}</dt><dd className="text-end font-medium text-ink">{v}</dd></div>))}</dl>
      </SectionCard>
      <Tips items={['Dates across the portal follow your format and time zone.', 'Switching to Urdu changes the layout to right-to-left.']} />
    </>
  );
}

// ── Data & Privacy ──────────────────────────────────────────────────────────
type DataReq = { id: string; kind: string; status: string; created_at: string; handled_at: string | null };

function DataSection() {
  const { prefs, save } = useMemberSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [deact, setDeact] = useState(false);
  const [del, setDel] = useState(new URLSearchParams(location.search).get('delete') === '1');
  const deletion = useQuery({ queryKey: ['deletion-request'], queryFn: () => get<{ status: string; created_at: string; admin_note: string | null } | null>('/api/v1/account/deletion-request') });
  const reqs = useQuery({ queryKey: ['data-requests'], queryFn: () => get<DataReq[]>('/api/v1/account/requests') });
  const cancel = useAction(() => api('/api/v1/account/deletion-request', { method: 'DELETE' }), { success: 'Request withdrawn.', invalidate: [['deletion-request'], ['data-requests']] });
  const exportNow = async () => { setBusy(true); try { await download('/api/v1/account/export', 'my-data.json'); reqs.refetch(); } finally { setBusy(false); } };
  return (
    <>
      <SectionCard title="Your Data" icon={Database}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <ul className="flex-1 space-y-2 text-sm">{['Profile, education and experience', 'Connections and followers', 'Posts, comments and messages you sent', 'Event registrations and job applications', 'Donations and settings'].map((t) => (
            <li key={t} className="flex gap-2 text-ink"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />{t}</li>))}</ul>
          <div className="flex flex-col items-center justify-center gap-2 rounded-card bg-primary-soft p-4 text-center sm:w-56">
            <Download className="h-7 w-7 text-primary" /><p className="font-semibold text-ink">Export Your Data</p><p className="text-xs text-ink-muted">A JSON file you can keep.</p>
            <Button loading={busy} onClick={exportNow}>Request Data Export</Button></div>
        </div>
      </SectionCard>
      <SectionCard title="Privacy & Consent" icon={ShieldCheck}><Rows>
        <PrefToggle k="consent_analytics" label="Allow use of my data for portal improvements" description="Anonymous usage statistics." />
        <PrefToggle k="consent_personalization" label="Allow personalized recommendations" />
        <PrefToggle k="consent_product_updates" label="Allow communications about new features and updates" />
        <PrefToggle k="consent_announcements" label="Allow occasional alumni and school announcements" />
      </Rows></SectionCard>
      <SectionCard title="Data Retention" icon={Info}>
        <LevelSelect label="Keep my account data for" value={prefs?.data_retention ?? 'policy'} options={[['policy', 'As per portal policy (Recommended)'], ['1y', '1 year after I stop using the portal'], ['3y', '3 years after I stop using the portal'], ['5y', '5 years after I stop using the portal']]}
          onChange={(v) => save.mutate({ data_retention: v }, { onSuccess: () => toast.success('Saved.') })} />
      </SectionCard>
      <SectionCard title="Account Actions" icon={SettingsIcon}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-line p-4"><p className="flex items-center gap-2 font-semibold text-ink"><PauseCircle className="h-5 w-5 text-warning" />Deactivate Account</p>
            <p className="mt-1 text-sm text-ink-muted">Temporarily hide your account. Sign in again any time to reactivate it.</p><Button variant="outline" className="mt-3" onClick={() => setDeact(true)}>Deactivate</Button></div>
          <div className="rounded-card border border-danger/40 p-4"><p className="flex items-center gap-2 font-semibold text-danger"><Trash2 className="h-5 w-5" />Delete Account</p>
            <p className="mt-1 text-sm text-ink-muted">Permanently delete your account after review by the alumni office.</p>
            {deletion.data?.status === 'pending' ? <><Badge tone="warning" className="mt-3">Requested {fmtDate(deletion.data.created_at)}</Badge><Button size="sm" variant="ghost" className="mt-2" onClick={() => cancel.mutate(undefined)}>Withdraw request</Button></>
              : <Button variant="danger-outline" className="mt-3" onClick={() => setDel(true)}>Delete Account</Button>}</div>
        </div>
      </SectionCard>
      {deact && <DeactivateDialog onClose={() => setDeact(false)} />}
      {del && <DeletionDialog onClose={() => { setDel(false); deletion.refetch(); reqs.refetch(); }} />}
    </>
  );
}

function DataAside() {
  const { prefs } = useMemberSettings();
  const reqs = useQuery({ queryKey: ['data-requests'], queryFn: () => get<DataReq[]>('/api/v1/account/requests') });
  const on = (b?: boolean) => b ? <Badge tone="success">Allowed</Badge> : <Badge>Off</Badge>;
  return (
    <>
      <SectionCard title="Privacy Summary" icon={ShieldCheck}>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-muted">Data export</dt><dd><Badge tone="success">Available</Badge></dd></div>
          {([['Analytics', prefs?.consent_analytics], ['Personalized recommendations', prefs?.consent_personalization], ['Product updates', prefs?.consent_product_updates], ['Announcements', prefs?.consent_announcements]] as const).map(([l, v]) => (
            <div key={l} className="flex justify-between gap-2"><dt className="text-ink-muted">{l}</dt><dd>{on(v)}</dd></div>))}
          <div className="flex justify-between"><dt className="text-ink-muted">Data retention</dt><dd className="font-medium text-ink">{prefs?.data_retention === 'policy' ? 'As per policy' : prefs?.data_retention}</dd></div>
        </dl>
      </SectionCard>
      <SectionCard title="Recent Data Requests" icon={Database}>
        {!reqs.data?.length ? <p className="text-sm text-ink-muted">No requests yet.</p> : (
          <ul className="divide-y divide-line text-sm">{reqs.data.slice(0, 6).map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span><span className="block font-medium capitalize text-ink">{r.kind === 'export' ? 'Data export' : 'Account deletion'}</span><span className="text-xs text-ink-muted">{fmtDate(r.created_at)}</span></span>
            <Badge tone={r.status === 'completed' ? 'success' : r.status === 'pending' ? 'warning' : 'neutral'} className="capitalize">{r.status}</Badge></li>)}</ul>
        )}
      </SectionCard>
      <Tips items={['Exports include everything the portal stores about you.', 'Deactivation is reversible; deletion is permanent.']} />
    </>
  );
}


import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Bell, Languages, Blocks, HandHeart, Building2, GraduationCap, LayoutDashboard, CheckCircle2, CreditCard, Flag, HardDrive, ImagePlus, Mail, MessageSquare, Palette, RadioTower,
  RotateCcw, Save, Send, Shield, Upload, Users, XCircle } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { themeVars, type Branding, type MediaItem } from '@/lib/site';
import { cn, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, PageHeader, Skeleton, StatTile } from '@/components/ui/display';
import { ColorInput, Field, Input, PasswordInput, Select, Switch, Textarea } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { LocalizationPanel } from './Administration';

const SECTIONS = [
  { key: 'general', label: 'General', icon: Building2, perm: 'settings.view' },
  { key: 'branding', label: 'Branding', icon: Palette, perm: 'branding.view' },
  { key: 'security', label: 'Authentication & security', icon: Shield, perm: 'settings.view' },
  { key: 'alumni', label: 'Alumni & registration', icon: GraduationCap, perm: 'settings.view' },
  { key: 'dashboard', label: 'Dashboard widgets', icon: LayoutDashboard, perm: 'settings.view' },
  { key: 'donations', label: 'Donations', icon: HandHeart, perm: 'donations.view' },
  { key: 'languages', label: 'Languages & translations', icon: Languages, perm: 'settings.view' },
  { key: 'realtime', label: 'Real-time & messaging', icon: RadioTower, perm: 'settings.view' },
  { key: 'modules', label: 'Modules', icon: Blocks, perm: 'modules.view' },
  { key: 'flags', label: 'Feature flags', icon: Flag, perm: 'feature_flags.view' },
  { key: 'email', label: 'Email (SMTP)', icon: Mail, perm: 'integrations.view' },
  { key: 'sms', label: 'SMS', icon: MessageSquare, perm: 'integrations.view' },
  { key: 'storage', label: 'File storage', icon: HardDrive, perm: 'integrations.view' },
  { key: 'payments', label: 'Payments', icon: CreditCard, perm: 'integrations.view' },
];

export function ConfigurationPage() {
  const { section } = useParams();
  const { can } = useAuth();
  const allowed = SECTIONS.filter((s) => can(s.perm));
  if (!section) return <Navigate to={`/admin/configuration/${allowed[0]?.key ?? 'general'}`} replace />;
  const cur = allowed.find((s) => s.key === section);
  return (
    <>
      <PageHeader title="System Configuration" description="Every operational setting is managed here — no file edits or rebuilds." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Configuration sections" className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
          {allowed.map((s) => (
            <NavLink key={s.key} to={`/admin/configuration/${s.key}`}
              className={({ isActive }) => cn('flex shrink-0 items-center gap-2.5 rounded-btn px-3 py-2 text-sm', isActive ? 'bg-surface font-medium text-primary shadow-card' : 'text-ink-muted hover:bg-surface hover:text-ink')}>
              <s.icon className="h-4 w-4" />{s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {!cur ? <Alert tone="warning">You do not have access to this section.</Alert>
            : section === 'general' ? <SettingsGroup group="general" />
            : section === 'security' ? <SettingsGroup group="security" />
            : section === 'realtime' ? <SettingsGroup group="realtime" />
            : section === 'alumni' ? <SettingsGroup group="alumni" />
            : section === 'dashboard' ? <DashboardWidgets />
            : section === 'donations' ? <SettingsGroup group="donations" />
            : section === 'languages' ? <LocalizationPanel />
            : section === 'branding' ? <BrandingEditor />
            : section === 'modules' ? <ModulesPanel />
            : section === 'flags' ? <FlagsPanel />
            : section === 'payments' ? <Card className="p-6"><Alert tone="info" title="Payments are not enabled yet">Online donations will use configurable payment providers. Each provider stays disabled until its credentials are entered and verified here.</Alert></Card>
            : <IntegrationPanel kind={section as 'email' | 'sms' | 'storage'} />}
        </div>
      </div>
    </>
  );
}

// ── settings groups ─────────────────────────────────────────────────────────
type FieldDef = { key: string; label: string; type: 'text' | 'number' | 'email' | 'bool' | 'select' | 'list' | 'textarea'; options?: [string, string][]; hint?: string; wide?: boolean };

const GROUPS: Record<'general' | 'security' | 'realtime' | 'alumni' | 'donations', { title: string; fields: FieldDef[] }> = {
  donations: { title: 'Donations', fields: [
    { key: 'bank_name', label: 'Bank name', type: 'text' },
    { key: 'account_title', label: 'Account title', type: 'text' },
    { key: 'iban', label: 'IBAN', type: 'text' },
    { key: 'account_number', label: 'Account number', type: 'text' },
    { key: 'branch', label: 'Branch', type: 'text', wide: true },
    { key: 'other_methods', label: 'Other ways to give', type: 'textarea', wide: true, hint: 'e.g. cash or cheque at the alumni office' },
    { key: 'instructions', label: 'Payment instructions', type: 'textarea', wide: true },
    { key: 'receipt_footer', label: 'Receipt footer', type: 'textarea', wide: true, hint: 'e.g. tax exemption note' },
    { key: 'min_amount', label: 'Minimum donation', type: 'number' },
    { key: 'show_donor_wall', label: 'Thank donors on campaign pages (with their consent)', type: 'bool' },
  ] },
  alumni: { title: 'Alumni & registration', fields: [
    { key: 'registration_open', label: 'Registration is open', type: 'bool' },
    { key: 'allow_student_registration', label: 'Current students may register', type: 'bool' },
    { key: 'require_phone', label: 'Mobile number required at registration', type: 'bool' },
    { key: 'require_registration_no', label: 'Student registration number required', type: 'bool' },
    { key: 'require_admission_year', label: 'Admission year required', type: 'bool' },
    { key: 'allow_verification_documents', label: 'Members may attach supporting documents', type: 'bool' },
    { key: 'directory_include_unverified', label: 'Show unverified members in the directory', type: 'bool' },
    { key: 'founding_year', label: 'First year of the school', type: 'number', hint: 'Earliest admission or graduation year accepted' },
    { key: 'record_match_action', label: 'When a registration matches a school record', type: 'select', wide: true, options: [
      ['verify', 'Verify automatically once the member proves the email or mobile number on the record'],
      ['review', 'Only show the match to an administrator']] },
    { key: 'default_profile_visibility', label: 'Default profile visibility', type: 'select', options: [['members', 'All members'], ['connections', 'Connections only'], ['hidden', 'Hidden']] },
    { key: 'default_contact_visibility', label: 'Default visibility of email and mobile', type: 'select', options: [['only_me', 'Only the member'], ['connections', 'Connections'], ['members', 'All members']] },
    { key: 'new_registration_email', label: 'Email new registrations to', type: 'email', hint: 'Leave empty to disable. The verification queue always lists them.' },
    { key: 'terms_url', label: 'Terms and privacy policy link', type: 'text', hint: 'Shown on the registration form' },
  ] },
  general: { title: 'General settings', fields: [
    { key: 'app_name', label: 'Application name', type: 'text' },
    { key: 'institution_name', label: 'Institution name', type: 'text' },
    { key: 'app_description', label: 'Application description', type: 'textarea', wide: true },
    { key: 'app_url', label: 'Application URL', type: 'text', hint: 'Used in emails and links', wide: true },
    { key: 'contact_email', label: 'Contact email', type: 'email' },
    { key: 'contact_phone', label: 'Contact phone', type: 'text' },
    { key: 'address', label: 'Address', type: 'text', wide: true },
    { key: 'default_language', label: 'Default language', type: 'select', options: [['en', 'English'], ['ur', 'اردو (Urdu)']] },
    { key: 'timezone', label: 'Timezone', type: 'select', options: ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'UTC'].map((t) => [t, t]) },
    { key: 'date_format', label: 'Date format', type: 'select', options: ['DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((t) => [t, t]) },
    { key: 'time_format', label: 'Time format', type: 'select', options: [['12h', '12-hour'], ['24h', '24-hour']] },
    { key: 'currency', label: 'Currency', type: 'select', options: ['PKR', 'USD', 'GBP', 'AED', 'SAR', 'EUR', 'CAD'].map((t) => [t, t]) },
    { key: 'page_size', label: 'Items per page', type: 'number' },
  ] },
  security: { title: 'Authentication & security', fields: [
    { key: 'min_password_length', label: 'Minimum password length', type: 'number', hint: '8–128' },
    { key: 'password_expiry_days', label: 'Password expiry (days)', type: 'number', hint: '0 = never expires' },
    { key: 'require_uppercase', label: 'Require an uppercase letter', type: 'bool' },
    { key: 'require_lowercase', label: 'Require a lowercase letter', type: 'bool' },
    { key: 'require_digit', label: 'Require a number', type: 'bool' },
    { key: 'require_symbol', label: 'Require a symbol', type: 'bool' },
    { key: 'max_login_attempts', label: 'Failed sign-ins before lockout', type: 'number', hint: 'At least 3' },
    { key: 'lockout_minutes', label: 'Lockout duration (minutes)', type: 'number' },
    { key: 'session_idle_minutes', label: 'Session timeout when idle (minutes)', type: 'number' },
    { key: 'session_absolute_days', label: 'Maximum session length (days)', type: 'number' },
    { key: 'mfa_policy', label: 'Two-factor authentication', type: 'select', options: [['optional', 'Optional'], ['required_staff', 'Required for administrators'], ['required_all', 'Required for everyone']] },
    { key: 'max_upload_mb', label: 'Maximum upload size (MB)', type: 'number', hint: 'Up to 100' },
    { key: 'require_email_verification', label: 'Require email verification', type: 'bool' },
    { key: 'require_phone_verification', label: 'Require mobile verification', type: 'bool' },
    { key: 'login_notifications', label: 'Email users about sign-ins from new devices', type: 'bool' },
    { key: 'allowed_file_types', label: 'Allowed file types', type: 'list', hint: 'Comma-separated extensions. Executable and script types are always blocked.', wide: true },
    { key: 'allowed_origins', label: 'Allowed origins for API access', type: 'list', hint: 'Other websites allowed to call the API from a browser, e.g. https://www.sst.edu.pk. Leave empty if none.', wide: true },
  ] },
  realtime: { title: 'Real-time & messaging', fields: [
    { key: 'max_connections_per_gateway', label: 'Maximum connections per gateway', type: 'number' },
    { key: 'heartbeat_interval_seconds', label: 'Heartbeat interval (seconds)', type: 'number' },
    { key: 'connection_timeout_seconds', label: 'Connection timeout (seconds)', type: 'number' },
    { key: 'presence_ttl_seconds', label: 'Presence expiry (seconds)', type: 'number' },
    { key: 'max_message_chars', label: 'Maximum message length (characters)', type: 'number' },
    { key: 'attachment_max_mb', label: 'Message attachment limit (MB)', type: 'number' },
    { key: 'messages_per_minute', label: 'Messages per minute per user', type: 'number' },
  ] },
};

function SettingsGroup({ group }: { group: 'general' | 'security' | 'realtime' | 'alumni' | 'donations' }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', group], queryFn: () => api<{ data: Record<string, unknown>; meta: { restart_required_fields: string[] } }>(`/api/v1/admin/config/settings/${group}`) });
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (q.data) setForm(q.data.data); }, [q.data]);
  const [restart, setRestart] = useState<string[]>([]);
  const save = useAction(() => api<{ meta: { restart_required: string[] } }>(`/api/v1/admin/config/settings/${group}`, { method: 'PUT', body: form }),
    { success: 'Settings saved.', invalidate: [['settings', group]], onSuccess: (r) => { setRestart(r.meta.restart_required); qc.invalidateQueries({ queryKey: ['site'] }); } });
  const def = GROUPS[group];
  const editable = can('settings.configure') || (group === 'donations' && can('donations.configure'));
  const restartFields = q.data?.meta.restart_required_fields ?? [];
  if (!form) return <Skeleton className="h-96 rounded-card" />;
  return (
    <Card>
      <CardHeader title={def.title} action={editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="space-y-4 p-5">
        {restart.length > 0 && <Alert tone="warning" title="Controlled restart required">Restart the real-time containers to apply: {restart.join(', ')}. Command: <code className="font-mono text-xs">docker compose restart realtime</code></Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {def.fields.map((f) => {
            const err = save.fieldErrors[f.key];
            const label = <>{f.label}{restartFields.includes(f.key) && <Badge tone="warning" className="ml-2">restart</Badge>}</>;
            if (f.type === 'bool') return (
              <div key={f.key} className="rounded-card border border-line p-3 sm:col-span-1">
                <Switch checked={!!form[f.key]} disabled={!editable} onCheckedChange={(v) => setForm({ ...form, [f.key]: v })} label={f.label} />
              </div>
            );
            return (
              <Field key={f.key} label={label} hint={f.hint} error={err} className={f.wide ? 'sm:col-span-2' : ''}>
                {(id, d) => f.type === 'select' ? (
                  <Select id={id} aria-describedby={d} disabled={!editable} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                    {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                ) : f.type === 'textarea' ? (
                  <Textarea id={id} aria-describedby={d} disabled={!editable} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="min-h-[70px]" />
                ) : f.type === 'list' ? (
                  <Input id={id} aria-describedby={d} disabled={!editable} value={((form[f.key] as string[]) ?? []).join(', ')}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                ) : (
                  <Input id={id} aria-describedby={d} aria-invalid={!!err} disabled={!editable} type={f.type} value={String(form[f.key] ?? '')}
                    onChange={(e) => setForm({ ...form, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value || (f.type === 'email' ? null : '') })} />
                )}
              </Field>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ── branding with live preview ──────────────────────────────────────────────
type BrandingResp = { draft: Branding; published: Branding; assets: Partial<Record<keyof Branding, MediaItem | null>>; has_unpublished_changes: boolean; version: number; published_at: string | null };
const FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Lato', 'Nunito Sans', 'System'];
const COLOR_LABELS: [keyof Branding['colors'], string][] = [
  ['primary_navy', 'Top navigation'], ['dark_navy', 'Footer / dark sections'], ['primary', 'Primary (buttons, active)'], ['secondary', 'Secondary (highlights)'],
  ['light', 'Light accent'], ['background', 'App background'], ['surface', 'Cards / workspace'], ['text_primary', 'Text'], ['text_secondary', 'Supporting text'],
  ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger'],
];
const ASSETS: [keyof Branding, string][] = [
  ['institution_logo', 'Institution logo'], ['logo_light', 'Logo for dark backgrounds'], ['logo_dark', 'Logo for light backgrounds'], ['favicon', 'Favicon'],
  ['login_background', 'Sign-in background'], ['dashboard_banner', 'Dashboard banner'],
];

function BrandingEditor() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['branding'], queryFn: () => get<BrandingResp>('/api/v1/admin/config/branding') });
  const [b, setB] = useState<Branding | null>(null);
  const [assets, setAssets] = useState<BrandingResp['assets']>({});
  useEffect(() => { if (q.data) { setB(q.data.draft); setAssets(q.data.assets); } }, [q.data]);
  const saveDraft = useAction((next: Branding) => api('/api/v1/admin/config/branding', { method: 'PUT', body: next }), { invalidate: [['branding']] });
  const publish = useAction(async () => {
    await api('/api/v1/admin/config/branding', { method: 'PUT', body: b });
    return api('/api/v1/admin/config/branding/publish', { method: 'POST' });
  }, { success: 'Branding published to every app.', invalidate: [['branding'], ['site']] });
  const discard = useAction(() => api('/api/v1/admin/config/branding/discard', { method: 'POST' }), { success: 'Changes discarded.', invalidate: [['branding']] });
  const editable = can('branding.edit');
  if (!b) return <Skeleton className="h-[600px] rounded-card" />;
  const set = (patch: Partial<Branding>) => setB({ ...b, ...patch });
  const dirty = JSON.stringify(b) !== JSON.stringify(q.data?.published);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Branding" description={`Published version ${q.data?.version} · ${fmtDateTime(q.data?.published_at)}`}
          action={editable && (
            <div className="flex gap-2">
              {dirty && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Discard unpublished changes?' })) { discard.mutate(undefined); } }}><RotateCcw />Discard</Button>}
              <Button variant="outline" onClick={() => saveDraft.mutate(b)} loading={saveDraft.isPending}><Save />Save draft</Button>
              {can('branding.publish') && <Button onClick={() => publish.mutate(undefined)} loading={publish.isPending} disabled={!dirty}><Upload />Publish</Button>}
            </div>
          )} />
        {dirty && <div className="px-5 pt-4"><Alert tone="warning">You have changes that are not published yet. Visitors still see the published branding.</Alert></div>}
        <div className="grid gap-6 p-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-ink">Colours</h3>
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {COLOR_LABELS.map(([k, l]) => <ColorInput key={k} label={l} value={b.colors[k]} onChange={(v) => set({ colors: { ...b.colors, [k]: v } })} />)}
              </div>
            </section>
            <section className="grid gap-4 sm:grid-cols-2">
              <Field label="Body font">{(id) => <Select id={id} value={b.font_body} onChange={(e) => set({ font_body: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select>}</Field>
              <Field label="Heading font">{(id) => <Select id={id} value={b.font_heading} onChange={(e) => set({ font_heading: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select>}</Field>
              <Field label={`Button radius: ${b.button_radius}px`}>{(id) => <input id={id} type="range" min={0} max={24} value={b.button_radius} onChange={(e) => set({ button_radius: Number(e.target.value) })} className="w-full accent-[rgb(var(--primary))]" />}</Field>
              <Field label={`Card radius: ${b.card_radius}px`}>{(id) => <input id={id} type="range" min={0} max={24} value={b.card_radius} onChange={(e) => set({ card_radius: Number(e.target.value) })} className="w-full accent-[rgb(var(--primary))]" />}</Field>
              <Field label="Colour mode">{(id) => <Select id={id} value={b.color_mode} onChange={(e) => set({ color_mode: e.target.value as Branding['color_mode'] })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Follow device</option></Select>}</Field>
              <Field label="Tagline">{(id) => <Input id={id} value={b.tagline} onChange={(e) => set({ tagline: e.target.value })} />}</Field>
              <Field label="Footer text" className="sm:col-span-2">{(id) => <Input id={id} value={b.footer_text} onChange={(e) => set({ footer_text: e.target.value })} placeholder="© SST Public School Rashidabad" />}</Field>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold text-ink">Logos & images</h3>
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {ASSETS.map(([k, l]) => (
                  <AssetPicker key={k} label={l} media={assets[k] ?? null} disabled={!editable}
                    onChange={(m) => { setAssets({ ...assets, [k]: m }); set({ [k]: m?.id ?? null } as Partial<Branding>); }} />
                ))}
              </div>
            </section>
          </div>
          <div className="xl:sticky xl:top-24 xl:self-start">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Live preview (draft)</p>
            <BrandPreview b={b} logo={assets.logo_light ?? assets.institution_logo ?? null} />
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Renders a miniature portal using the draft branding (scoped CSS variables). */
function BrandPreview({ b, logo }: { b: Branding; logo: MediaItem | null }) {
  return (
    <div style={themeVars(b) as React.CSSProperties} className="overflow-hidden rounded-card border border-line bg-canvas font-sans text-ink shadow-card">
      <div className="flex items-center gap-2 bg-navy px-3 py-2.5 text-white">
        {logo ? <img src={logo.url} alt="" className="h-6 w-auto" /> : <span className="h-6 w-6 rounded bg-white/15" />}
        <span className="text-[11px] font-semibold">Alumni Portal</span>
        <span className="ml-auto flex gap-3 text-[10px] text-white/80"><span className="border-b-2 border-secondary pb-0.5 text-white">Dashboard</span><span>Network</span><span>Events</span></span>
      </div>
      <div className="space-y-3 p-3">
        <div className="rounded-card bg-navy p-3 text-white">
          <p className="font-heading text-sm font-semibold">SST Alumni <span className="text-secondary">Connect</span></p>
          <p className="mt-0.5 text-[10px] text-white/80">{b.tagline}</p>
          <div className="mt-2 flex gap-1.5"><span className="rounded-btn bg-primary px-2 py-1 text-[10px] font-medium">Update Profile</span><span className="rounded-btn border border-white/70 px-2 py-1 text-[10px]">Find Alumni</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile icon={Users} value="4,860" label="Alumni" />
          <StatTile icon={CheckCircle2} tone="success" value="3,920" label="Verified" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">Primary</Badge><Badge tone="success">Success</Badge><Badge tone="warning">Warning</Badge><Badge tone="danger">Danger</Badge>
        </div>
      </div>
      <div className="bg-navy-dark px-3 py-2 text-[10px] text-white/70">{b.footer_text || '© Footer'}</div>
    </div>
  );
}

function AssetPicker({ label, media, onChange, disabled }: { label: string; media: MediaItem | null; onChange: (m: MediaItem | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const up = useAction(async (f: File) => {
    const fd = new FormData();
    fd.set('file', f);
    fd.set('folder', 'branding');
    fd.set('images_only', 'true');
    return (await api<{ data: MediaItem }>('/api/v1/admin/media', { method: 'POST', body: fd })).data;
  }, { onSuccess: onChange });
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink">{label}</p>
      <div className="flex h-24 items-center justify-center rounded-card border border-dashed border-line bg-[conic-gradient(#f1f2f6_25%,#fff_0_50%,#f1f2f6_0_75%,#fff_0)] bg-[length:16px_16px]">
        {media ? <img src={media.variants[0]?.url ?? media.url} alt="" className="max-h-20 max-w-[85%] object-contain" /> : <ImagePlus className="h-6 w-6 text-ink-muted" />}
      </div>
      {!disabled && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => ref.current?.click()} loading={up.isPending}><Upload />{media ? 'Replace' : 'Upload'}</Button>
          {media && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
        </div>
      )}
      <input ref={ref} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,.ico" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
    </div>
  );
}

// ── modules & flags ─────────────────────────────────────────────────────────
function ModulesPanel() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['modules'], queryFn: () => get<{ key: string; name: string; description: string; enabled: boolean }[]>('/api/v1/admin/config/modules') });
  const toggle = useAction(({ key, enabled }: { key: string; enabled: boolean }) => api(`/api/v1/admin/config/modules/${key}`, { method: 'PUT', body: { enabled } }),
    { success: (_r) => 'Module updated.', invalidate: [['modules'], ['site']] });
  return (
    <Card>
      <CardHeader title="Modules" description="Disabling a module hides it and blocks its API. Its data is kept and returns when re-enabled." />
      <ul className="divide-y divide-line">
        {q.data ? q.data.map((m) => (
          <li key={m.key} className="px-5 py-4">
            <Switch checked={m.enabled} disabled={!can('modules.configure') || toggle.isPending} onCheckedChange={(v) => toggle.mutate({ key: m.key, enabled: v })} label={m.name} description={m.description} />
          </li>
        )) : Array.from({ length: 6 }).map((_, i) => <li key={i} className="px-5 py-4"><Skeleton className="h-6" /></li>)}
      </ul>
    </Card>
  );
}

function FlagsPanel() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['flags'], queryFn: () => get<{ key: string; name: string; description: string; enabled: boolean; roles: string[] }[]>('/api/v1/admin/config/feature-flags') });
  const roles = useQuery({ queryKey: ['roles-brief'], queryFn: () => get<{ key: string; name: string }[]>('/api/v1/admin/roles'), enabled: can('roles.view') });
  const save = useAction(({ key, enabled, roles }: { key: string; enabled: boolean; roles: string[] }) => api(`/api/v1/admin/config/feature-flags/${key}`, { method: 'PUT', body: { enabled, roles } }),
    { success: 'Feature flag saved.', invalidate: [['flags'], ['site']] });
  const editable = can('feature_flags.configure');
  return (
    <Card>
      <CardHeader title="Feature flags" description="Turn features on without deploying. Optionally limit a feature to some roles." />
      <ul className="divide-y divide-line">
        {q.data ? q.data.map((f) => (
          <li key={f.key} className="space-y-3 px-5 py-4">
            <Switch checked={f.enabled} disabled={!editable} onCheckedChange={(v) => save.mutate({ key: f.key, enabled: v, roles: f.roles })} label={f.name} description={f.description} />
            {f.enabled && roles.data && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-ink-muted">Visible to:</span>
                <button disabled={!editable} onClick={() => save.mutate({ key: f.key, enabled: true, roles: [] })}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs', !f.roles.length ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-muted')}>Everyone</button>
                {roles.data.map((r) => {
                  const on = f.roles.includes(r.key);
                  return <button key={r.key} disabled={!editable} onClick={() => save.mutate({ key: f.key, enabled: true, roles: on ? f.roles.filter((x) => x !== r.key) : [...f.roles, r.key] })}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-muted hover:border-primary/40')}>{r.name}</button>;
                })}
              </div>
            )}
          </li>
        )) : Array.from({ length: 4 }).map((_, i) => <li key={i} className="px-5 py-4"><Skeleton className="h-6" /></li>)}
      </ul>
    </Card>
  );
}

// ── integrations ────────────────────────────────────────────────────────────
type Integration = { kind: string; provider: string | null; config: Record<string, unknown>; secrets: Record<string, string>; enabled: boolean;
  last_test: { at: string; ok: boolean; message: string } | null; providers: string[] };

const SMTP_DEFAULT = { host: '', port: 587, encryption: 'starttls', username: '', sender_name: 'SST Alumni Connect', sender_email: '', reply_to: '' };
const SMS_DEFAULT = { endpoint: '', method: 'POST', sender_id: '', account_id: '', auth_style: 'bearer', auth_field: 'api_key', content_type: 'json',
  body_template: '{"to": "{{to}}", "message": "{{message}}", "sender": "{{sender_id}}"}', extra_params: {}, success_codes: [200, 201, 202] };
const STORAGE_DEFAULT = { endpoint: '', bucket: 'alumni-media', region: '', secure: true, public_url: '', access: 'public' };

function IntegrationPanel({ kind }: { kind: 'email' | 'sms' | 'storage' }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<{ data: Integration[]; meta: { bundled_storage: boolean } }>('/api/v1/admin/config/integrations') });
  const integ = q.data?.data.find((i) => i.kind === kind);
  const [provider, setProvider] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (!integ) return;
    const p = integ.provider ?? (kind === 'email' ? 'smtp' : kind === 'sms' ? 'http' : q.data?.meta.bundled_storage ? 'minio' : 'local');
    setProvider(p);
    const base = kind === 'email' ? SMTP_DEFAULT : kind === 'sms' ? SMS_DEFAULT : STORAGE_DEFAULT;
    setConfig({ ...base, ...integ.config });
    setSecrets(integ.secrets);
    setEnabled(integ.enabled);
  }, [integ, kind, q.data?.meta.bundled_storage]);
  const editable = can('integrations.configure');
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
  const save = useAction(() => api('/api/v1/admin/config/integrations/' + kind, { method: 'PUT', body: { provider, config: provider === 'local' ? {} : clean(config), secrets, enabled } }),
    { success: 'Settings saved. Secrets are stored encrypted.', invalidate: [['integrations']] });
  const test = useAction(() => api<{ data: { ok: boolean; message: string } }>(`/api/v1/admin/config/integrations/${kind}/test`, { method: 'POST', body: { send_to: testTo || null } }),
    { invalidate: [['integrations']], onSuccess: (r) => setResult(r.data) });
  if (!integ) return <Skeleton className="h-96 rounded-card" />;
  const c = (k: string) => String(config[k] ?? '');
  const setC = (k: string, v: unknown) => setConfig({ ...config, [k]: v });
  const e = save.fieldErrors;
  const fe = (k: string) => e[`config.${k}`] ?? e[k];
  const titles = { email: 'Email (SMTP)', sms: 'SMS provider', storage: 'File storage' };
  const icon = { email: Mail, sms: Bell, storage: HardDrive }[kind];

  return (
    <Card>
      <CardHeader title={titles[kind]} icon={icon}
        description={kind === 'sms' ? 'Works with most HTTP SMS gateways: set the endpoint, how the API key is sent and the request template.' : kind === 'storage' ? 'Where uploaded files are kept. Existing files stay where they were uploaded.' : 'Used for verification, password resets and notifications.'}
        action={editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="space-y-5 p-5">
        {integ.last_test && (
          <div className={cn('flex items-center gap-2 text-sm', integ.last_test.ok ? 'text-success' : 'text-danger')}>
            {integ.last_test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            Last test {fmtDateTime(integ.last_test.at)}: {integ.last_test.message}
          </div>
        )}
        {kind !== 'storage' && <Switch checked={enabled} disabled={!editable} onCheckedChange={setEnabled} label={`Enable ${kind === 'email' ? 'email' : 'SMS'} delivery`} />}

        {kind === 'email' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SMTP host" required className="sm:col-span-2" error={fe('host')}>{(id) => <Input id={id} disabled={!editable} value={c('host')} onChange={(x) => setC('host', x.target.value)} />}</Field>
            <Field label="Port" required error={fe('port')}>{(id) => <Input id={id} type="number" disabled={!editable} value={c('port')} onChange={(x) => setC('port', Number(x.target.value))} />}</Field>
            <Field label="Encryption">{(id) => <Select id={id} disabled={!editable} value={c('encryption')} onChange={(x) => setC('encryption', x.target.value)}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></Select>}</Field>
            <Field label="Username">{(id) => <Input id={id} disabled={!editable} autoComplete="off" value={c('username')} onChange={(x) => setC('username', x.target.value)} />}</Field>
            <Field label="Password" hint="Leave as is to keep the saved password">{(id, d) => <PasswordInput id={id} aria-describedby={d} disabled={!editable} autoComplete="new-password" value={secrets.password ?? ''} onChange={(x) => setSecrets({ ...secrets, password: x.target.value })} />}</Field>
            <Field label="Sender name">{(id) => <Input id={id} disabled={!editable} value={c('sender_name')} onChange={(x) => setC('sender_name', x.target.value)} />}</Field>
            <Field label="Sender email" required error={fe('sender_email')}>{(id) => <Input id={id} type="email" disabled={!editable} value={c('sender_email')} onChange={(x) => setC('sender_email', x.target.value)} />}</Field>
            <Field label="Reply-to email" error={fe('reply_to')}>{(id) => <Input id={id} type="email" disabled={!editable} value={c('reply_to')} onChange={(x) => setC('reply_to', x.target.value)} />}</Field>
          </div>
        )}

        {kind === 'sms' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API endpoint" required className="sm:col-span-2" error={fe('endpoint')}>{(id) => <Input id={id} disabled={!editable} value={c('endpoint')} onChange={(x) => setC('endpoint', x.target.value)} placeholder="https://api.provider.com/v1/sms" />}</Field>
            <Field label="Method">{(id) => <Select id={id} disabled={!editable} value={c('method')} onChange={(x) => setC('method', x.target.value)}><option>POST</option><option>GET</option></Select>}</Field>
            <Field label="Body format">{(id) => <Select id={id} disabled={!editable} value={c('content_type')} onChange={(x) => setC('content_type', x.target.value)}><option value="json">JSON</option><option value="form">Form fields</option></Select>}</Field>
            <Field label="API key" hint="Leave as is to keep the saved key">{(id, d) => <PasswordInput id={id} aria-describedby={d} disabled={!editable} value={secrets.api_key ?? ''} onChange={(x) => setSecrets({ ...secrets, api_key: x.target.value })} />}</Field>
            <Field label="Send the API key as">{(id) => <Select id={id} disabled={!editable} value={c('auth_style')} onChange={(x) => setC('auth_style', x.target.value)}><option value="bearer">Bearer token</option><option value="header">Custom header</option><option value="query">Query parameter</option><option value="body">Body field</option></Select>}</Field>
            {c('auth_style') !== 'bearer' && <Field label="Header / parameter name">{(id) => <Input id={id} disabled={!editable} value={c('auth_field')} onChange={(x) => setC('auth_field', x.target.value)} />}</Field>}
            <Field label="Sender ID">{(id) => <Input id={id} disabled={!editable} value={c('sender_id')} onChange={(x) => setC('sender_id', x.target.value)} />}</Field>
            <Field label="Account identifier">{(id) => <Input id={id} disabled={!editable} value={c('account_id')} onChange={(x) => setC('account_id', x.target.value)} />}</Field>
            <Field label="Request template" className="sm:col-span-2" hint="Placeholders: {{to}} {{message}} {{sender_id}} {{account_id}} {{api_key}}" error={fe('body_template')}>
              {(id, d) => <Textarea id={id} aria-describedby={d} disabled={!editable} value={c('body_template')} onChange={(x) => setC('body_template', x.target.value)} className="font-mono text-xs" />}
            </Field>
          </div>
        )}

        {kind === 'storage' && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {integ.providers.map((p) => (
                <button key={p} type="button" disabled={!editable || (p === 'minio' && !q.data?.meta.bundled_storage)} onClick={() => setProvider(p)}
                  className={cn('rounded-card border p-4 text-left disabled:opacity-50', provider === p ? 'border-primary bg-primary-soft/60 ring-1 ring-primary' : 'border-line hover:border-primary/40')}>
                  <p className="text-sm font-semibold text-ink">{{ local: 'Local disk', minio: 'Bundled MinIO', s3: 'Amazon S3 / compatible' }[p]}</p>
                </button>
              ))}
            </div>
            {provider !== 'local' && (
              <div className="grid gap-4 sm:grid-cols-2">
                {provider === 's3' && <Field label="Endpoint" hint="Empty for Amazon S3" error={fe('endpoint')}>{(id, d) => <Input id={id} aria-describedby={d} disabled={!editable} value={c('endpoint')} onChange={(x) => setC('endpoint', x.target.value)} />}</Field>}
                {provider === 's3' && <Field label="Region">{(id) => <Input id={id} disabled={!editable} value={c('region')} onChange={(x) => setC('region', x.target.value)} />}</Field>}
                <Field label="Bucket" required error={fe('bucket')}>{(id) => <Input id={id} disabled={!editable} value={c('bucket')} onChange={(x) => setC('bucket', x.target.value)} />}</Field>
                {provider === 's3' && <Field label="Public URL" hint="Base address serving public files">{(id, d) => <Input id={id} aria-describedby={d} disabled={!editable} value={c('public_url')} onChange={(x) => setC('public_url', x.target.value)} />}</Field>}
                {provider === 's3' && <Field label="Access key">{(id) => <Input id={id} disabled={!editable} autoComplete="off" value={secrets.access_key ?? ''} onChange={(x) => setSecrets({ ...secrets, access_key: x.target.value })} />}</Field>}
                {provider === 's3' && <Field label="Secret key" hint="Leave as is to keep the saved key">{(id, d) => <PasswordInput id={id} aria-describedby={d} disabled={!editable} value={secrets.secret_key ?? ''} onChange={(x) => setSecrets({ ...secrets, secret_key: x.target.value })} />}</Field>}
                <Field label="Access policy">{(id) => <Select id={id} disabled={!editable} value={c('access')} onChange={(x) => setC('access', x.target.value)}><option value="public">Public files readable by anyone</option><option value="private">Private (served through the API)</option></Select>}</Field>
              </div>
            )}
            <Switch checked={enabled || provider === 'local'} disabled={!editable || provider === 'local'} onCheckedChange={setEnabled} label="Use this storage for new uploads" />
          </>
        )}

        {editable && (
          <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-canvas/60 p-4">
            {kind !== 'storage' && (
              <Field label={kind === 'email' ? 'Send a test email to (optional)' : 'Send a test SMS to'} className="min-w-[240px] flex-1">
                {(id) => <Input id={id} value={testTo} onChange={(x) => setTestTo(x.target.value)} placeholder={kind === 'email' ? 'you@example.com' : '+92 300 1234567'} />}
              </Field>
            )}
            <Button variant="outline" onClick={() => { setResult(null); test.mutate(undefined); }} loading={test.isPending}><Send />{kind === 'storage' ? 'Test storage' : testTo ? 'Send test' : 'Test connection'}</Button>
            <p className="w-full text-xs text-ink-muted">Tests use the saved settings — save first.</p>
          </div>
        )}
        {result && <Alert tone={result.ok ? 'success' : 'danger'}>{result.message}</Alert>}
      </div>
    </Card>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold text-ink">{children}</h3>;
}

// ── alumni dashboard widgets ────────────────────────────────────────────────
const WIDGETS: Record<string, [string, string]> = {
  welcome: ['Welcome banner', 'Greeting with the dashboard banner image.'],
  verification: ['Verification status', 'Shows unverified members how to get verified.'],
  profile_completion: ['Profile completion', 'Progress and the next steps to complete a profile.'],
  stats: ['Alumni statistics', 'Registered and verified alumni, countries, batches.'],
  connection_requests: ['Connection requests', 'Pending requests with accept / decline.'],
  suggestions: ['People you may know', 'Batchmates and alumni in the same city or industry.'],
  by_country: ['Alumni by country', 'Where alumni live today.'],
  by_year: ['Alumni by graduation year', 'Registered alumni per graduating class.'],
  upcoming_events: ['Upcoming events', 'Next events and your registrations.'],
  community_posts: ['Latest community posts', 'Recent posts from the community feed.'],
  latest_jobs: ['Latest job opportunities', 'Newest approved jobs and internships.'],
  achievements: ['Recent achievements', 'Recently published alumni achievements.'],
  mentors: ['Mentorship recommendations', 'Mentors matching the member’s industry.'],
  quick_actions: ['Quick actions', 'Shortcuts to common tasks.'],
};
type Widget = { key: string; enabled: boolean; roles: string[] };

function DashboardWidgets() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['settings', 'dashboard'], queryFn: () => get<{ widgets: Widget[] }>('/api/v1/admin/config/settings/dashboard') });
  const roles = useQuery({ queryKey: ['roles-brief'], queryFn: () => get<{ key: string; name: string; is_staff: boolean }[]>('/api/v1/admin/roles'), enabled: can('roles.view') });
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  useEffect(() => { if (q.data) setWidgets(q.data.widgets); }, [q.data]);
  const save = useAction(() => api('/api/v1/admin/config/settings/dashboard', { method: 'PUT', body: { widgets } }), { success: 'Dashboard widgets saved.', invalidate: [['settings', 'dashboard']] });
  const editable = can('settings.configure');
  if (!widgets) return <Skeleton className="h-96 rounded-card" />;
  const memberRoles = (roles.data ?? []).filter((r) => !r.is_staff);
  const move = (i: number, d: number) => setWidgets((w) => { const n = [...w!]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; return n; });
  const patch = (i: number, p: Partial<Widget>) => setWidgets((w) => w!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Card>
      <CardHeader title="Alumni dashboard widgets" description="Order, visibility and audience of the widgets on members' dashboards. Widgets of later modules (events, jobs, community…) are added here as they are delivered."
        action={editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <ul className="divide-y divide-line">
        {widgets.map((w, i) => (
          <li key={w.key} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Move up" disabled={!editable || i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button size="icon" variant="ghost" aria-label="Move down" disabled={!editable || i === widgets.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
            </div>
            <div className="min-w-0 flex-1">
              <Switch checked={w.enabled} disabled={!editable} onCheckedChange={(v) => patch(i, { enabled: v })} label={WIDGETS[w.key]?.[0] ?? w.key} description={WIDGETS[w.key]?.[1]} />
            </div>
            {memberRoles.length > 0 && (
              <Select aria-label={`Who sees ${WIDGETS[w.key]?.[0]}`} disabled={!editable || !w.enabled} value={w.roles.length === 1 ? w.roles[0] : w.roles.length ? 'custom' : ''}
                onChange={(e) => patch(i, { roles: e.target.value ? [e.target.value] : [] })} className="lg:w-56">
                <option value="">Everyone</option>
                {w.roles.length > 1 && <option value="custom" disabled>{w.roles.length} roles</option>}
                {memberRoles.map((r) => <option key={r.key} value={r.key}>Only {r.name}</option>)}
              </Select>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

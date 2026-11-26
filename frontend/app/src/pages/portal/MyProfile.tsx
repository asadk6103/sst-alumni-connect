import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BadgeCheck, Briefcase, ListPlus, Camera, CheckCircle2, Eye, FileText, GraduationCap, KeyRound, Lock, Paperclip, Pencil, Plus,
  Save, Send, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { api, download, get } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ACHIEVEMENT_KINDS, METHOD_LABEL, monthYear, yearsRange, type Achievement, type Education, type Employment, type Level,
  type MyProfile, type ProfileDetail, type PublicBatch } from '@/lib/alumni';
import { COUNTRIES, INDUSTRIES } from '@/lib/countries';
import { cn, fmtBytes, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { PersonAvatar, ProfileBody, VerifiedBadge } from '@/components/alumni';
import { CustomFieldsForm, customErrors, useCustomFields, type CustomValues } from '@/components/customFields';

const TABS = [
  { key: 'personal', label: 'Personal', icon: UserRound },
  { key: 'professional', label: 'Professional', icon: Briefcase },
  { key: 'experience', label: 'Experience', icon: Briefcase },
  { key: 'education', label: 'Education', icon: GraduationCap },
  { key: 'achievements', label: 'Achievements', icon: Award },
  { key: 'more', label: 'Additional details', icon: ListPlus },
  { key: 'privacy', label: 'Privacy', icon: Eye },
  { key: 'verification', label: 'Verification', icon: BadgeCheck },
] as const;

export function MyProfilePage() {
  const { tab = 'personal' } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['my-profile'], queryFn: () => get<MyProfile>('/api/v1/alumni/me') });
  const [preview, setPreview] = useState(false);
  const extra = useCustomFields('alumni_profile');
  const p = q.data;
  return (
    <>
      {preview && p && <PreviewDialog id={p.id} onClose={() => setPreview(false)} />}
      <PageHeader title="My Profile" description="What other alumni see depends on your privacy settings."
        actions={p && <Button variant="outline" onClick={() => setPreview(true)}><Eye />Preview as a member</Button>} />
      {!p ? <Skeleton className="h-96 rounded-card" /> : (
        <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
          <div className="min-w-0 space-y-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <PersonAvatar p={p} size={52} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate font-medium text-ink">{p.full_name}{p.verified && <VerifiedBadge />}</p>
                  <p className="text-xs text-ink-muted">{p.completion}% complete</p>
                </div>
              </div>
              <Progress value={p.completion} className="mt-3" label="Profile completion" />
            </Card>
            <Card className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-0.5">
              {TABS.filter((t) => t.key !== 'more' || !!extra.data?.length).map((t) => (
                <button key={t.key} onClick={() => nav(`/portal/profile/edit/${t.key}`)} aria-current={tab === t.key ? 'page' : undefined}
                  className={cn('flex shrink-0 items-center gap-2.5 rounded-btn px-3 py-2 text-left text-sm lg:w-full',
                    tab === t.key ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-canvas')}>
                  <t.icon className="h-4 w-4" />{t.label}
                  {t.key === 'verification' && !p.verified && <span className="ml-auto h-2 w-2 rounded-full bg-warning" aria-label="Action needed" />}
                </button>
              ))}
            </Card>
          </div>
          <div className="min-w-0 space-y-6">
            {tab === 'personal' && <Personal p={p} />}
            {tab === 'professional' && <Professional p={p} />}
            {tab === 'experience' && <Entries<Employment> p={p} section="employment" />}
            {tab === 'education' && <Entries<Education> p={p} section="education" />}
            {tab === 'achievements' && <Entries<Achievement> p={p} section="achievements" />}
            {tab === 'more' && extra.data && <MoreDetails p={p} />}
            {tab === 'privacy' && <Privacy p={p} />}
            {tab === 'verification' && <Verification p={p} />}
          </div>
        </div>
      )}
    </>
  );
}

const Lockable = ({ locked, children }: { locked: boolean; children: ReactNode }) => (
  <div className="relative">{children}{locked && <Lock className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-label="Locked after verification" />}</div>
);

function Personal({ p }: { p: MyProfile }) {
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ['public-batches'], queryFn: () => api<{ data: PublicBatch[]; meta: { founding_year: number } }>('/api/v1/public/batches', { auth: false }) });
  const [f, setF] = useState({
    full_name: p.full_name, gender: p.gender ?? '', date_of_birth: p.date_of_birth ?? '', admission_year: p.admission_year ? String(p.admission_year) : '',
    graduation_year: p.graduation_year ? String(p.graduation_year) : '', batch_id: p.batch_id ?? '', class_name: p.class_name ?? '',
    registration_no: p.registration_no ?? '', city: p.city ?? '', country: p.country ?? '', bio: p.bio ?? '',
  });
  const locked = new Set(p.locked_fields);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const body: Record<string, unknown> = {
    full_name: f.full_name, gender: f.gender || null, date_of_birth: f.date_of_birth || null, class_name: f.class_name || null,
    city: f.city || null, country: f.country || null, bio: f.bio || null,
  };
  if (!locked.has('graduation_year')) Object.assign(body, {
    kind: p.kind, admission_year: f.admission_year ? Number(f.admission_year) : null, graduation_year: f.graduation_year ? Number(f.graduation_year) : null,
    batch_id: f.batch_id || null, registration_no: f.registration_no || null,
  });
  const save = useAction(() => api('/api/v1/alumni/me', { method: 'PUT', body }),
    { success: 'Profile saved.', invalidate: [['my-profile'], ['alumni-dashboard']] });
  const e = save.fieldErrors;
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction((file: File) => { const fd = new FormData(); fd.append('file', file); return api('/api/v1/alumni/me/photo', { method: 'POST', body: fd }); },
    { success: 'Photo updated.', invalidate: [['my-profile'], ['alumni-dashboard']] });
  const removePhoto = useAction(() => api('/api/v1/alumni/me/photo', { method: 'DELETE' }), { success: 'Photo removed.', invalidate: [['my-profile']] });
  const thisYear = new Date().getFullYear();
  const founding = batches.data?.meta.founding_year ?? 1985;
  const yearOpts = p.kind === 'student' ? yearsRange(thisYear, thisYear + 12).reverse() : yearsRange(founding, thisYear);
  const yearBatches = (batches.data?.data ?? []).filter((b) => String(b.graduation_year) === f.graduation_year);
  useEffect(() => () => { qc.invalidateQueries({ queryKey: ['directory'] }); }, [qc]);

  return (
    <>
      <Card>
        <CardHeader title="Profile photo" icon={Camera} />
        <div className="flex flex-wrap items-center gap-4 p-5">
          <PersonAvatar p={p} size={88} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Camera />{p.photo ? 'Change photo' : 'Upload photo'}</Button>
              {p.photo && <Button variant="ghost" onClick={() => removePhoto.mutate(undefined)}><Trash2 />Remove</Button>}
            </div>
            <p className="text-xs text-ink-muted">JPG, PNG or WebP. Location data in photos is removed automatically.</p>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(ev) => { const file = ev.target.files?.[0]; if (file) upload.mutate(file); ev.target.value = ''; }} />
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Personal information" icon={UserRound} action={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
        <div className="space-y-4 p-5">
          {locked.size > 0 && <Alert tone="info">Your school details were confirmed during verification. To correct them, contact the alumni office.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={e.full_name}>{(id) => <Input id={id} value={f.full_name} onChange={(x) => set('full_name', x.target.value)} />}</Field>
            <Field label="Gender" error={e.gender}>{(id) => <Select id={id} value={f.gender} onChange={(x) => set('gender', x.target.value)}>
              <option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>}</Field>
            <Field label="Admission year" error={e.admission_year}>{(id) => <Lockable locked={locked.has('admission_year')}>
              <Select id={id} value={f.admission_year} disabled={locked.has('admission_year')} onChange={(x) => set('admission_year', x.target.value)}>
                <option value="">—</option>{yearsRange(founding, thisYear).map((y) => <option key={y}>{y}</option>)}</Select></Lockable>}</Field>
            <Field label={p.kind === 'student' ? 'Expected graduation year' : 'Graduation year'} error={e.graduation_year}>{(id) => <Lockable locked={locked.has('graduation_year')}>
              <Select id={id} value={f.graduation_year} disabled={locked.has('graduation_year')} onChange={(x) => { set('graduation_year', x.target.value); set('batch_id', ''); }}>
                <option value="">—</option>{yearOpts.map((y) => <option key={y}>{y}</option>)}</Select></Lockable>}</Field>
            <Field label="Batch" error={e.batch_id}>{(id) => <Lockable locked={locked.has('batch_id')}>
              <Select id={id} value={f.batch_id} disabled={locked.has('batch_id') || !yearBatches.length} onChange={(x) => set('batch_id', x.target.value)}>
                <option value="">{yearBatches.length ? 'Select…' : p.batch ?? '—'}</option>{yearBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Lockable>}</Field>
            <Field label="Class / section" error={e.class_name}>{(id) => <Input id={id} value={f.class_name} onChange={(x) => set('class_name', x.target.value)} />}</Field>
            <Field label="Student registration number" error={e.registration_no}>{(id) => <Lockable locked={locked.has('registration_no')}>
              <Input id={id} value={f.registration_no} disabled={locked.has('registration_no')} onChange={(x) => set('registration_no', x.target.value)} /></Lockable>}</Field>
            <Field label="Date of birth" error={e.date_of_birth}>{(id) => <Input id={id} type="date" value={f.date_of_birth} onChange={(x) => set('date_of_birth', x.target.value)} />}</Field>
            <Field label="City" error={e.city}>{(id) => <Input id={id} value={f.city} onChange={(x) => set('city', x.target.value)} />}</Field>
            <Field label="Country" error={e.country}>{(id) => (<><Input id={id} list="countries-p" value={f.country} onChange={(x) => set('country', x.target.value)} />
              <datalist id="countries-p">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist></>)}</Field>
            <Field label="Short biography" error={e.bio} hint={`${f.bio.length}/2000 · at least 30 characters count towards completion`} className="sm:col-span-2">
              {(id, d) => <Textarea id={id} aria-describedby={d} maxLength={2000} value={f.bio} onChange={(x) => set('bio', x.target.value)} placeholder="Tell batchmates what you have been up to since school." />}</Field>
          </div>
        </div>
      </Card>
    </>
  );
}

function MoreDetails({ p }: { p: MyProfile }) {
  const defs = useCustomFields('alumni_profile');
  const [v, setV] = useState<CustomValues>(p.custom_fields ?? {});
  const save = useAction(() => api('/api/v1/alumni/me', { method: 'PUT', body: { custom_fields: v } }),
    { success: 'Profile saved.', invalidate: [['my-profile']] });
  return (
    <Card>
      <CardHeader title="Additional details" icon={ListPlus} description="Extra information the alumni office asks members to share. Each item shows who can see it."
        action={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="p-5">
        {defs.data && <CustomFieldsForm defs={defs.data} value={v} onChange={setV} errors={customErrors(save.fieldErrors)} />}
        <p className="mt-4 text-xs text-ink-muted">
          {defs.data?.some((d) => d.visibility === 'private') && 'Fields marked private are seen only by you and the alumni office. '}
          Other fields follow the visibility chosen by the alumni office for each question.
        </p>
      </div>
    </Card>
  );
}

function Professional({ p }: { p: MyProfile }) {
  const [f, setF] = useState({ designation: p.designation ?? '', organization: p.organization ?? '', industry: p.industry ?? '', linkedin: p.linkedin ?? '', website: p.website ?? '' });
  const [skills, setSkills] = useState<string[]>(p.skills);
  const [skill, setSkill] = useState('');
  const save = useAction(async () => {
    await api('/api/v1/alumni/me', { method: 'PUT', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) });
    await api('/api/v1/alumni/me/skills', { method: 'PUT', body: { skills } });
  }, { success: 'Profile saved.', invalidate: [['my-profile'], ['alumni-dashboard']] });
  const e = save.fieldErrors;
  const add = () => {
    const s = skill.trim();
    if (s && !skills.some((x) => x.toLowerCase() === s.toLowerCase()) && skills.length < 40) setSkills([...skills, s.slice(0, 60)]);
    setSkill('');
  };
  return (
    <Card>
      <CardHeader title="Professional information" icon={Briefcase} action={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Current designation" error={e.designation}>{(id) => <Input id={id} value={f.designation} onChange={(x) => setF({ ...f, designation: x.target.value })} placeholder="e.g. Senior Consultant" />}</Field>
        <Field label="Organisation" error={e.organization}>{(id) => <Input id={id} value={f.organization} onChange={(x) => setF({ ...f, organization: x.target.value })} />}</Field>
        <Field label="Industry" error={e.industry}>{(id) => <Select id={id} value={f.industry} onChange={(x) => setF({ ...f, industry: x.target.value })}>
          <option value="">Select…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}{f.industry && !INDUSTRIES.includes(f.industry) && <option>{f.industry}</option>}</Select>}</Field>
        <Field label="LinkedIn profile" error={e.linkedin}>{(id) => <Input id={id} value={f.linkedin} onChange={(x) => setF({ ...f, linkedin: x.target.value })} placeholder="linkedin.com/in/…" />}</Field>
        <Field label="Professional website" error={e.website} className="sm:col-span-2">{(id) => <Input id={id} value={f.website} onChange={(x) => setF({ ...f, website: x.target.value })} placeholder="https://…" />}</Field>
        <Field label="Skills" hint="Press Enter to add. Up to 40." error={e.skills} className="sm:col-span-2">{(id, d) => (
          <div className="rounded-btn border border-line p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">{s}
                  <button type="button" aria-label={`Remove ${s}`} onClick={() => setSkills(skills.filter((x) => x !== s))}><X className="h-3 w-3" /></button></span>
              ))}
              <input id={id} aria-describedby={d} value={skill} onChange={(x) => setSkill(x.target.value)} onBlur={add}
                onKeyDown={(x) => { if (x.key === 'Enter' || x.key === ',') { x.preventDefault(); add(); } else if (x.key === 'Backspace' && !skill && skills.length) setSkills(skills.slice(0, -1)); }}
                className="min-w-[140px] flex-1 bg-transparent px-1 py-1 text-sm outline-none" placeholder={skills.length ? '' : 'e.g. Project management'} />
            </div>
          </div>)}</Field>
      </div>
    </Card>
  );
}

// ── repeatable sections ─────────────────────────────────────────────────────
type SectionKey = 'employment' | 'education' | 'achievements';
const META: Record<SectionKey, { title: string; icon: typeof Briefcase; empty: string; add: string }> = {
  employment: { title: 'Work experience', icon: Briefcase, empty: 'Add the positions you have held since school.', add: 'Add position' },
  education: { title: 'Education', icon: GraduationCap, empty: 'Add your degrees, diplomas and qualifications after SST.', add: 'Add education' },
  achievements: { title: 'Achievements', icon: Award, empty: 'Awards, recognitions, publications, certifications and milestones.', add: 'Add achievement' },
};

function Entries<T extends { id: string }>({ p, section }: { p: MyProfile; section: SectionKey }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const rows = (section === 'employment' ? p.employment : section === 'education' ? p.education : p.achievements) as unknown as T[];
  const del = useAction((id: string) => api(`/api/v1/alumni/me/${section}/${id}`, { method: 'DELETE' }), { success: 'Removed.', invalidate: [['my-profile']] });
  const m = META[section];
  return (
    <Card>
      <CardHeader title={m.title} icon={m.icon} action={<Button onClick={() => setEditing('new')}><Plus />{m.add}</Button>} />
      {rows.length === 0 ? <EmptyState icon={m.icon} title={`No ${m.title.toLowerCase()} yet`} description={m.empty} /> : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 text-sm">{summary(section, r)}</div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(r)}><Pencil /></Button>
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={async () => { if (await confirm({ title: 'Remove this entry?', confirmLabel: 'Remove', danger: true })) del.mutate(r.id); }}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <EntryDialog section={section} entry={editing === 'new' ? null : editing as unknown as Record<string, unknown>} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function summary(section: SectionKey, r: unknown) {
  if (section === 'employment') {
    const e = r as Employment;
    return (<><p className="font-medium text-ink">{e.designation}{e.is_current && <Badge tone="success" className="ml-2">Current</Badge>}</p>
      <p className="text-ink">{e.organization}{e.industry ? ` · ${e.industry}` : ''}</p>
      <p className="text-xs text-ink-muted">{[e.start_date && `${monthYear(e.start_date)} – ${e.is_current ? 'Present' : monthYear(e.end_date) || '…'}`, e.location].filter(Boolean).join(' · ')}</p></>);
  }
  if (section === 'education') {
    const e = r as Education;
    return (<><p className="font-medium text-ink">{e.qualification}{e.field_of_study ? `, ${e.field_of_study}` : ''}{e.is_sst && <Badge tone="primary" className="ml-2">SST</Badge>}</p>
      <p className="text-ink">{e.institution}</p>{(e.start_year || e.end_year) && <p className="text-xs text-ink-muted">{e.start_year ?? '…'} – {e.end_year ?? 'present'}</p>}</>);
  }
  const a = r as Achievement;
  return (<><p className="font-medium text-ink">{a.title}<Badge tone="primary" className="ml-2">{ACHIEVEMENT_KINDS.find(([k]) => k === a.kind)?.[1]}</Badge></p>
    <p className="text-xs text-ink-muted">{[a.issuer, a.year].filter(Boolean).join(' · ')}</p></>);
}

const BLANK: Record<SectionKey, Record<string, unknown>> = {
  employment: { organization: '', designation: '', industry: '', location: '', start_date: '', end_date: '', is_current: false, description: '' },
  education: { institution: '', qualification: '', field_of_study: '', start_year: '', end_year: '', is_sst: false, description: '' },
  achievements: { kind: 'award', title: '', issuer: '', year: '', url: '', description: '' },
};

function EntryDialog({ section, entry, onClose }: { section: SectionKey; entry: Record<string, unknown> | null; onClose: () => void }) {
  const [f, setF] = useState<Record<string, unknown>>(() => {
    const base = { ...BLANK[section] };
    if (entry) for (const k of Object.keys(base)) base[k] = entry[k] ?? (typeof base[k] === 'boolean' ? false : '');
    return base;
  });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k,
    typeof v === 'string' ? (v.trim() === '' ? null : ['start_year', 'end_year', 'year'].includes(k) ? Number(v) : v.trim()) : v]));
  const save = useAction(() => api(entry ? `/api/v1/alumni/me/${section}/${entry.id}` : `/api/v1/alumni/me/${section}`, { method: entry ? 'PUT' : 'POST', body: clean }),
    { success: 'Saved.', invalidate: [['my-profile'], ['alumni-dashboard']], onSuccess: onClose });
  const e = save.fieldErrors;
  const txt = (k: string, label: string, opts: { required?: boolean; wide?: boolean; type?: string; placeholder?: string } = {}) => (
    <Field label={label} required={opts.required} error={e[k]} className={opts.wide ? 'sm:col-span-2' : ''}>
      {(id) => <Input id={id} type={opts.type ?? 'text'} placeholder={opts.placeholder} value={String(f[k] ?? '')} onChange={(x) => set(k, x.target.value)} />}
    </Field>
  );
  const years = yearsRange(1950, new Date().getFullYear() + 6);
  const yearSel = (k: string, label: string) => (
    <Field label={label} error={e[k]}>{(id) => <Select id={id} value={String(f[k] ?? '')} onChange={(x) => set(k, x.target.value)}>
      <option value="">—</option>{years.map((y) => <option key={y}>{y}</option>)}</Select>}</Field>
  );
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={`${entry ? 'Edit' : 'Add'} ${META[section].title.toLowerCase().replace(/s$/, '')}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}><Save />Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {section === 'employment' && (<>
          {txt('designation', 'Designation', { required: true })}{txt('organization', 'Organisation', { required: true })}
          <Field label="Industry" error={e.industry}>{(id) => <Select id={id} value={String(f.industry ?? '')} onChange={(x) => set('industry', x.target.value)}>
            <option value="">—</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
          {txt('location', 'Location', { placeholder: 'City, country' })}
          {txt('start_date', 'Start date', { type: 'date' })}
          {!f.is_current && txt('end_date', 'End date', { type: 'date' })}
          <div className="sm:col-span-2"><Checkbox checked={!!f.is_current} onCheckedChange={(v) => { set('is_current', v); if (v) set('end_date', ''); }} label="I currently work here (updates my headline)" /></div>
          <Field label="Description" error={e.description} className="sm:col-span-2">{(id) => <Textarea id={id} maxLength={2000} value={String(f.description ?? '')} onChange={(x) => set('description', x.target.value)} />}</Field>
        </>)}
        {section === 'education' && (<>
          {txt('qualification', 'Qualification', { required: true, placeholder: 'e.g. BSc, MBBS, A-Levels' })}{txt('field_of_study', 'Field of study')}
          {txt('institution', 'Institution', { required: true, wide: true })}
          {yearSel('start_year', 'Start year')}{yearSel('end_year', 'End year')}
          <div className="sm:col-span-2"><Checkbox checked={!!f.is_sst} onCheckedChange={(v) => set('is_sst', v)} label="This was at SST (part of my school history — always visible)" /></div>
        </>)}
        {section === 'achievements' && (<>
          <Field label="Type" required>{(id) => <Select id={id} value={String(f.kind)} onChange={(x) => set('kind', x.target.value)}>
            {ACHIEVEMENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          {yearSel('year', 'Year')}
          {txt('title', 'Title', { required: true, wide: true })}{txt('issuer', 'Issued by / publisher')}{txt('url', 'Link', { placeholder: 'https://…' })}
          <Field label="Description" error={e.description} className="sm:col-span-2">{(id) => <Textarea id={id} maxLength={1000} value={String(f.description ?? '')} onChange={(x) => set('description', x.target.value)} />}</Field>
        </>)}
      </div>
    </Dialog>
  );
}

// ── privacy ─────────────────────────────────────────────────────────────────
const LEVEL_LABEL: Record<Level, string> = { members: 'All members', connections: 'My connections', only_me: 'Only me' };

function Privacy({ p }: { p: MyProfile }) {
  const [visibility, setVisibility] = useState(p.privacy.visibility);
  const [sections, setSections] = useState(p.privacy.sections);
  const save = useAction(() => api('/api/v1/alumni/me/privacy', { method: 'PUT', body: { visibility, sections } }),
    { success: 'Privacy settings saved.', invalidate: [['my-profile'], ['directory']] });
  return (
    <Card>
      <CardHeader title="Privacy" icon={ShieldCheck} description="Choose who sees your profile and each part of it. Administrators of the alumni office can always see your full profile."
        action={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="space-y-6 p-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Who can find my profile in the directory</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['members', 'All members', 'Verified alumni can find and view you.'], ['connections', 'Connections only', 'Only people you are connected with.'],
              ['hidden', 'Nobody', 'Hidden from the directory and profile pages.']] as const).map(([k, l, d]) => (
              <button key={k} type="button" onClick={() => setVisibility(k)} aria-pressed={visibility === k}
                className={cn('rounded-card border p-3 text-left', visibility === k ? 'border-primary bg-primary-soft' : 'border-line hover:bg-canvas')}>
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">{visibility === k && <CheckCircle2 className="h-4 w-4 text-primary" />}{l}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{d}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Who can see each section</p>
          <p className="mb-3 text-xs text-ink-muted">Your name, photo, batch and verification badge are visible whenever your profile is. Sections you do not share are also left out of directory search and filters.</p>
          <ul className="divide-y divide-line rounded-card border border-line">
            {Object.entries(p.privacy_sections).map(([k, label]) => (
              <li key={k} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-ink">{label}</span>
                <Select aria-label={`Who can see: ${label}`} value={sections[k]} onChange={(x) => setSections({ ...sections, [k]: x.target.value as Level })} className="sm:w-48">
                  {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ── verification ────────────────────────────────────────────────────────────
function Verification({ p }: { p: MyProfile }) {
  const v = p.verification;
  const confirm = useConfirm();
  const [code, setCode] = useState('');
  const [note, setNote] = useState(v.note ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const inv = [['my-profile'], ['alumni-dashboard']];
  const redeem = useAction(() => api('/api/v1/alumni/me/verification/code', { method: 'POST', body: { code } }),
    { success: 'Verified — welcome to the alumni community! Sign in again to unlock every feature.', invalidate: inv, onSuccess: () => setTimeout(() => window.location.reload(), 1500) });
  const resubmit = useAction(() => api('/api/v1/alumni/me/verification', { method: 'POST', body: { note: note || null } }),
    { success: 'Submitted for verification.', invalidate: inv });
  const upload = useAction((file: File) => { const fd = new FormData(); fd.append('file', file); return api('/api/v1/alumni/me/verification/documents', { method: 'POST', body: fd }); },
    { success: 'Document attached.', invalidate: inv });
  const removeDoc = useAction((id: string) => api(`/api/v1/alumni/me/verification/documents/${id}`, { method: 'DELETE' }), { success: 'Document removed.', invalidate: inv });
  const history = useQuery({ queryKey: ['my-verification-history'], queryFn: () => get<{ action: string; method: string | null; note: string | null; created_at: string }[]>('/api/v1/alumni/me/verification/history') });

  if (v.status === 'verified') {
    return (
      <Card>
        <CardHeader title="Verification" icon={BadgeCheck} />
        <div className="p-5">
          <Alert tone="success" title="Your profile is verified">{METHOD_LABEL[v.method ?? ''] ?? 'Verified'}{v.verified_at ? ` on ${fmtDate(v.verified_at)}` : ''}. The verification badge appears on your profile.</Alert>
        </div>
      </Card>
    );
  }
  return (
    <>
      {v.status === 'rejected'
        ? <Alert tone="danger" title="We could not verify your profile yet">{v.rejection_reason} — correct your details (Personal tab), attach a document if helpful, and submit again.</Alert>
        : <Alert tone="info" title="Waiting for verification">Submitted {fmtDate(v.submitted_at)}. The alumni office checks every registration against school records. Use one of the options below to speed this up.</Alert>}
      <Card>
        <CardHeader title="Have a code from the alumni office?" icon={KeyRound} description="Codes are handed out at reunions, by batch coordinators or by the alumni office." />
        <div className="flex flex-col gap-3 p-5 sm:flex-row">
          <Input aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" className="font-mono tracking-widest sm:max-w-xs" />
          <Button loading={redeem.isPending} disabled={code.replace(/[^A-Z0-9]/g, '').length < 6} onClick={() => redeem.mutate(undefined)}><BadgeCheck />Verify with code</Button>
        </div>
      </Card>
      {v.documents_allowed && (
        <Card>
          <CardHeader title="Supporting documents" icon={Paperclip} description="For example a school leaving certificate, result card or student ID. Only the alumni office can open them."
            action={<Button variant="outline" loading={upload.isPending} disabled={v.documents.length >= 5} onClick={() => fileRef.current?.click()}><Plus />Attach</Button>} />
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
          {v.documents.length === 0 ? <p className="p-5 text-sm text-ink-muted">No documents attached. PDF or image, up to 5 files.</p> : (
            <ul className="divide-y divide-line">
              {v.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <button className="flex min-w-0 items-center gap-2 text-left text-ink hover:text-primary" onClick={() => download(`/api/v1/alumni/me/verification/documents/${d.id}`, d.filename)}>
                    <FileText className="h-4 w-4 shrink-0 text-ink-muted" /><span className="truncate">{d.filename}</span><span className="shrink-0 text-xs text-ink-muted">{fmtBytes(d.size)}</span>
                  </button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${d.filename}`} onClick={async () => { if (await confirm({ title: 'Remove document?', confirmLabel: 'Remove', danger: true })) removeDoc.mutate(d.id); }}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title={v.status === 'rejected' ? 'Submit again' : 'Message to the alumni office'} icon={Send} />
        <div className="space-y-3 p-5">
          <Field label="Note (optional)" hint="Anything that helps, e.g. your class teacher or house.">{(id, d) => <Textarea id={id} aria-describedby={d} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Button loading={resubmit.isPending} onClick={() => resubmit.mutate(undefined)}><Send />{v.status === 'rejected' ? 'Submit for verification' : 'Update my submission'}</Button>
        </div>
      </Card>
      {history.data && history.data.length > 0 && (
        <Card>
          <CardHeader title="History" />
          <ul className="divide-y divide-line">
            {history.data.map((h, i) => (
              <li key={i} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="text-ink"><span className="capitalize">{h.action}</span>{h.note ? <span className="text-ink-muted"> — {h.note}</span> : ''}</span>
                <span className="shrink-0 text-xs text-ink-muted">{fmtDate(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function PreviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['alumni-profile', id, 'as-member'], queryFn: () => get<ProfileDetail>(`/api/v1/alumni/profiles/${id}?as_member=true`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Your profile as other members see it"
      description="Connections may see more, depending on your privacy settings.">
      {q.data ? <ProfileBody p={q.data} header={false} /> : q.isError ? <Alert tone="info">Your profile becomes visible to other members once it is verified.</Alert> : <Skeleton className="h-72" />}
    </Dialog>
  );
}

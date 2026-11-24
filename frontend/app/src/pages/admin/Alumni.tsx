import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Ban, Check, Download, FileText, Flag, GraduationCap, Pencil, Plus, Search, ShieldX, Users, X } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { METHOD_LABEL, photoUrl, yearsRange, type Achievement, type Education, type Employment, type Photo } from '@/lib/alumni';
import { COUNTRIES, INDUSTRIES } from '@/lib/countries';
import { fmtBytes, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';

export type AlumniRow = {
  id: string; full_name: string; email: string; phone: string | null; account_status: string; email_verified: boolean; phone_verified: boolean;
  kind: 'alumni' | 'student'; graduation_year: number | null; admission_year: number | null; batch_id: string | null; batch: string | null;
  registration_no: string | null; city: string | null; country: string | null; designation: string | null; organization: string | null;
  verification_status: 'pending' | 'verified' | 'rejected'; verification_method: string | null; match_strength: 'strong' | 'partial' | null;
  submitted_at: string | null; verified_at: string | null; documents: number; completion: number; photo: Photo; created_at: string;
};
type RecordMatch = { id: string; registration_no: string; full_name: string; father_name: string | null; date_of_birth: string | null;
  admission_year: number | null; graduation_year: number | null; class_name: string | null; batch: string | null; email: string | null; phone: string | null };
export type AlumniDetail = Omit<AlumniRow, 'documents'> & {
  bio: string | null; skills: string[]; employment: Employment[]; education: Education[]; achievements: Achievement[]; followers: number;
  connections: number; website: string | null; linkedin: string | null; gender: string | null; date_of_birth: string | null; class_name: string | null;
  industry: string | null; visibility: string; privacy: Record<string, string>; verification_note: string | null; rejection_reason: string | null;
  documents: { id: string; filename: string; size: number; mime: string; created_at: string }[]; open_reports: number;
  record: RecordMatch | null; roles: { key: string; name: string }[]; last_login_at: string | null;
  history: { action: string; method: string | null; note: string | null; actor: string | null; created_at: string }[];
};
type Batch = { id: string; name: string; graduation_year: number };

export const VTONE = { pending: 'warning', verified: 'success', rejected: 'danger' } as const;
export const VLABEL = { pending: 'Pending', verified: 'Verified', rejected: 'Rejected' } as const;

export function useBatches() {
  return useQuery({ queryKey: ['admin-batches-brief'], queryFn: () => get<Batch[]>('/api/v1/admin/batches'), staleTime: 60_000 });
}

export function AlumniPage() {
  const { tab = 'list' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Alumni Management" description="Alumni and student records, profiles and reports." />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'list' ? '/admin/alumni' : `/admin/alumni/${v}`)}
        tabs={[{ value: 'list', label: 'Alumni' }, { value: 'reports', label: 'Reported profiles' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'reports' ? <Reports /> : <AlumniList canEdit={can('alumni.edit')} />}</div>
    </>
  );
}

function AlumniList({ canEdit }: { canEdit: boolean }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [search] = useSearchParams();
  const [batch, setBatch] = useState(search.get('batch') ?? '');
  const [year, setYear] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('-created');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const params = { q: dq, status, batch, year, kind, sort, page, page_size: 20 };
  const list = useQuery({ queryKey: ['admin-alumni', params], queryFn: () => api<Paged<AlumniRow>>(`/api/v1/admin/alumni${qs(params)}`), placeholderData: keepPreviousData });
  const batches = useBatches();
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search alumni" placeholder="Name, email, phone, registration no. or organisation…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:flex">
            <Select aria-label="Verification" value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className="xl:w-36">
              <option value="">Any status</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select>
            <Select aria-label="Batch" value={batch} onChange={(e) => reset(() => setBatch(e.target.value))} className="xl:w-44">
              <option value="">All batches</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <Select aria-label="Graduation year" value={year} onChange={(e) => reset(() => setYear(e.target.value))} className="xl:w-32">
              <option value="">Any year</option>{yearsRange(1960, new Date().getFullYear() + 12).map((y) => <option key={y}>{y}</option>)}</Select>
            <Select aria-label="Type" value={kind} onChange={(e) => reset(() => setKind(e.target.value))} className="xl:w-32">
              <option value="">All types</option><option value="alumni">Alumni</option><option value="student">Students</option></Select>
          </div>
          <div className="flex gap-2">
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="xl:w-40">
              <option value="-created">Newest first</option><option value="name">Name</option><option value="-year">Graduation year ↓</option>
              <option value="year">Graduation year ↑</option><option value="-completion">Profile completion</option></Select>
            {can('alumni.export') && <Button variant="outline" onClick={() => download(`/api/v1/admin/alumni/export${qs({ q: dq, status, batch, year, kind })}`, 'alumni.csv')}><Download />CSV</Button>}
            {can('alumni.create') && <Button onClick={() => setAdding(true)}><Plus />Add</Button>}
          </div>
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState icon={Users} title="No alumni found" description="Registrations, invitations and records added here appear in this list." />}
          columns={[
            { key: 'name', header: 'Name', cell: (r) => (
              <div className="flex items-center gap-3">
                <Avatar name={r.full_name} src={photoUrl(r.photo, 80)} size={36} />
                <div className="min-w-0"><p className="truncate font-medium">{r.full_name}</p><p className="truncate text-xs text-ink-muted">{r.email}</p></div>
              </div>) },
            { key: 'class', header: 'Class', cell: (r) => <div className="text-sm"><p>{r.batch ?? (r.graduation_year ? `Class of ${r.graduation_year}` : '—')}</p>{r.kind === 'student' && <Badge>Student</Badge>}</div> },
            { key: 'work', header: 'Today', hideOnMobile: true, cell: (r) => <div className="max-w-[220px] text-sm"><p className="truncate">{r.designation ?? '—'}</p><p className="truncate text-xs text-ink-muted">{[r.organization, r.country].filter(Boolean).join(' · ')}</p></div> },
            { key: 'status', header: 'Verification', cell: (r) => <div className="flex flex-wrap gap-1"><Badge tone={VTONE[r.verification_status]}>{VLABEL[r.verification_status]}</Badge>{r.account_status !== 'active' && <Badge>{r.account_status === 'pending' ? 'Email unconfirmed' : 'Deactivated'}</Badge>}</div> },
            { key: 'completion', header: 'Profile', hideOnMobile: true, cell: (r) => <div className="w-24"><Progress value={r.completion} label="Profile completion" /><span className="text-xs text-ink-muted">{r.completion}%</span></div> },
            { key: 'joined', header: 'Joined', hideOnMobile: true, cell: (r) => <span className="text-ink-muted" title={fmtDateTime(r.created_at)}>{timeAgo(r.created_at)}</span> },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {open && <AlumniDetailDialog id={open} onClose={() => setOpen(null)} canEdit={canEdit} />}
      {adding && <AlumniFormDialog onClose={() => setAdding(false)} />}
    </>
  );
}

export function AlumniDetailDialog({ id, onClose, canEdit }: { id: string; onClose: () => void; canEdit?: boolean }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['admin-alumni-detail', id], queryFn: () => get<AlumniDetail>(`/api/v1/admin/alumni/${id}`) });
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | 'revoke' | null>(null);
  const d = q.data;
  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()} wide title={d ? d.full_name : 'Alumni record'}
        footer={d && <>
          {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />Edit record</Button>}
          {d.verification_status !== 'verified' && can('verification.reject') && d.verification_status !== 'rejected' && <Button variant="danger-outline" onClick={() => setDeciding('reject')}><X />Reject</Button>}
          {d.verification_status === 'verified' && can('verification.reject') && <Button variant="danger-outline" onClick={() => setDeciding('revoke')}><ShieldX />Revoke verification</Button>}
          {d.verification_status !== 'verified' && can('verification.approve') && <Button onClick={() => setDeciding('approve')}><BadgeCheck />Verify</Button>}
        </>}>
        {!d ? <Skeleton className="h-80" /> : <DetailBody d={d} />}
      </Dialog>
      {editing && d && <AlumniFormDialog existing={d} onClose={() => setEditing(false)} />}
      {deciding && d && <DecisionDialog d={d} action={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); }} />}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-sm"><dt className="text-ink-muted">{label}</dt><dd className="min-w-0 break-words text-ink">{children ?? '—'}</dd></div>;
}

function DetailBody({ d }: { d: AlumniDetail }) {
  const recordDiff = (a: unknown, b: unknown) => a != null && b != null && String(a).toLowerCase() !== String(b).toLowerCase();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={d.full_name} src={photoUrl(d.photo, 160)} size={64} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={VTONE[d.verification_status]}>{VLABEL[d.verification_status]}</Badge>
            {d.verification_method && <span className="text-xs text-ink-muted">{METHOD_LABEL[d.verification_method] ?? d.verification_method}</span>}
            {d.kind === 'student' && <Badge>Student</Badge>}
            {d.open_reports > 0 && <Badge tone="danger"><Flag className="h-3 w-3" />{d.open_reports} open report(s)</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">{[d.designation, d.organization].filter(Boolean).join(' at ') || 'No position given'}</p>
        </div>
      </div>
      {d.rejection_reason && <Alert tone="danger" title="Last decision">{d.rejection_reason}</Alert>}
      {d.verification_note && <Alert tone="info" title="Note from the member">{d.verification_note}</Alert>}
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <Row label="Email">{d.email} {d.email_verified ? <Badge tone="success">confirmed</Badge> : <Badge>unconfirmed</Badge>}</Row>
          <Row label="Mobile">{d.phone ? <>{d.phone} {d.phone_verified ? <Badge tone="success">verified</Badge> : null}</> : null}</Row>
          <Row label="Registration no.">{d.registration_no}</Row>
          <Row label="Admission / graduation">{[d.admission_year ?? '—', d.graduation_year ?? '—'].join(' → ')}</Row>
          <Row label="Batch">{d.batch}</Row>
          <Row label="Class / section">{d.class_name}</Row>
        </div>
        <div>
          <Row label="Date of birth">{d.date_of_birth ? fmtDate(d.date_of_birth) : null}</Row>
          <Row label="Location">{[d.city, d.country].filter(Boolean).join(', ') || null}</Row>
          <Row label="Industry">{d.industry}</Row>
          <Row label="Roles">{d.roles.map((r) => r.name).join(', ')}</Row>
          <Row label="Registered">{fmtDateTime(d.created_at)}</Row>
          <Row label="Last sign-in">{d.last_login_at ? fmtDateTime(d.last_login_at) : 'Never'}</Row>
        </div>
      </dl>
      <Card>
        <CardHeader title="School record match" icon={GraduationCap}
          description={d.record ? (d.match_strength === 'strong' ? 'Identity and contact details match the school record.' : 'Partial match — compare before verifying.') : 'No imported school record matches this registration.'} />
        {d.record && (
          <div className="overflow-x-auto p-3">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-muted"><th className="px-2 py-1 font-medium" /><th className="px-2 py-1 font-medium">Registration</th><th className="px-2 py-1 font-medium">School record</th></tr></thead>
              <tbody className="divide-y divide-line">
                {([['Name', d.full_name, d.record.full_name], ['Registration no.', d.registration_no, d.record.registration_no], ['Graduation year', d.graduation_year, d.record.graduation_year],
                  ['Admission year', d.admission_year, d.record.admission_year], ['Date of birth', d.date_of_birth, d.record.date_of_birth], ['Email', d.email, d.record.email],
                  ['Mobile', d.phone, d.record.phone], ['Father’s name', '—', d.record.father_name]] as [string, unknown, unknown][]).map(([l, a, b]) => (
                  <tr key={l} className={recordDiff(a, b) ? 'bg-warning/5' : ''}>
                    <td className="px-2 py-1.5 text-ink-muted">{l}</td><td className="px-2 py-1.5">{String(a ?? '—')}</td><td className="px-2 py-1.5">{String(b ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {d.documents.length > 0 && (
        <Card>
          <CardHeader title="Supporting documents" icon={FileText} description="Private — opening a document is recorded in the audit log." />
          <ul className="divide-y divide-line">
            {d.documents.map((doc) => (
              <li key={doc.id}><button onClick={() => download(`/api/v1/admin/verification/${d.id}/documents/${doc.id}`, doc.filename)}
                className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm text-ink hover:bg-canvas"><FileText className="h-4 w-4 text-ink-muted" />{doc.filename}
                <span className="ml-auto text-xs text-ink-muted">{fmtBytes(doc.size)} · {fmtDate(doc.created_at)}</span></button></li>
            ))}
          </ul>
        </Card>
      )}
      {d.history.length > 0 && (
        <Card>
          <CardHeader title="Verification history" />
          <ul className="divide-y divide-line">
            {d.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                <span><span className="font-medium capitalize text-ink">{h.action}</span>{h.method && <span className="text-ink-muted"> · {METHOD_LABEL[h.method] ?? h.method}</span>}
                  {h.actor && <span className="text-ink-muted"> · {h.actor}</span>}{h.note && <span className="block text-xs text-ink-muted">{h.note}</span>}</span>
                <span className="shrink-0 text-xs text-ink-muted">{fmtDateTime(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(d.bio || d.skills.length > 0 || d.employment.length > 0) && (
        <Card>
          <CardHeader title="Profile" />
          <div className="space-y-3 p-5 text-sm">
            {d.bio && <p className="whitespace-pre-line text-ink">{d.bio}</p>}
            {d.skills.length > 0 && <div className="flex flex-wrap gap-1">{d.skills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}</div>}
            {d.employment.map((e) => <p key={e.id} className="text-ink">{e.designation}, {e.organization}{e.is_current ? ' (current)' : ''}</p>)}
            {d.education.filter((e) => !e.is_sst).map((e) => <p key={e.id} className="text-ink">{e.qualification}, {e.institution}</p>)}
            <p className="text-xs text-ink-muted">Profile visibility: {d.visibility} · {d.connections} connections · {d.followers} followers</p>
          </div>
        </Card>
      )}
    </div>
  );
}

export function DecisionDialog({ d, action, onClose, onDone }: { d: Pick<AlumniRow, 'id' | 'full_name'> & { record?: RecordMatch | null }; action: 'approve' | 'reject' | 'revoke'; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [useRecord, setUseRecord] = useState(!!d.record);
  const run = useAction(() => api(`/api/v1/admin/verification/${d.id}/${action}`, { method: 'POST',
    body: action === 'approve' ? { note: text || null, record_id: useRecord && d.record ? d.record.id : null } : { reason: text } }),
  { success: action === 'approve' ? `${d.full_name} is now verified.` : action === 'reject' ? 'Registration rejected; the member was emailed.' : 'Verification revoked.',
    invalidate: [['admin-alumni'], ['admin-alumni-detail'], ['admin-verification'], ['admin-dashboard']], onSuccess: onDone });
  const title = action === 'approve' ? `Verify ${d.full_name}` : action === 'reject' ? `Reject ${d.full_name}` : `Revoke verification of ${d.full_name}`;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={title}
      description={action === 'approve' ? 'The member becomes verified alumni (or student) and gets full access.' : 'The member is emailed this reason and can correct their details and resubmit.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={action === 'approve' ? 'primary' : 'danger'} loading={run.isPending} disabled={action !== 'approve' && text.trim().length < 3} onClick={() => run.mutate(undefined)}>
          {action === 'approve' ? <><Check />Verify</> : action === 'reject' ? <><X />Reject</> : <><Ban />Revoke</>}</Button></>}>
      <div className="space-y-4">
        {action === 'approve' && d.record && <Checkbox checked={useRecord} onCheckedChange={setUseRecord} label={`Link to school record ${d.record.registration_no} (${d.record.full_name})`} />}
        <Field label={action === 'approve' ? 'Internal note (optional)' : 'Reason (sent to the member)'} required={action !== 'approve'} error={run.fieldErrors.reason}>
          {(id) => <Textarea id={id} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={action === 'approve' ? 'e.g. Confirmed with class teacher' : 'e.g. We could not find your registration number in our records. Please attach your school leaving certificate.'} />}
        </Field>
      </div>
    </Dialog>
  );
}

export function AlumniFormDialog({ existing, onClose }: { existing?: AlumniDetail; onClose: () => void }) {
  const { can } = useAuth();
  const batches = useBatches();
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    full_name: s(existing?.full_name), email: s(existing?.email), phone: s(existing?.phone), kind: existing?.kind ?? 'alumni',
    gender: s(existing?.gender), date_of_birth: s(existing?.date_of_birth), admission_year: s(existing?.admission_year),
    graduation_year: s(existing?.graduation_year), batch_id: s(existing?.batch_id), class_name: s(existing?.class_name),
    registration_no: s(existing?.registration_no), city: s(existing?.city), country: s(existing?.country), designation: s(existing?.designation),
    organization: s(existing?.organization), industry: s(existing?.industry), verified: true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v ? Number(v) : null);
  const o = (v: string) => v.trim() || null;
  const body = {
    full_name: f.full_name, phone: o(f.phone), kind: f.kind, gender: o(f.gender), date_of_birth: o(f.date_of_birth), admission_year: n(f.admission_year),
    graduation_year: n(f.graduation_year), batch_id: o(f.batch_id), class_name: o(f.class_name), registration_no: o(f.registration_no), city: o(f.city),
    country: o(f.country), designation: o(f.designation), organization: o(f.organization),
    ...(existing ? { industry: o(f.industry) } : { email: f.email, verified: f.verified && can('verification.approve') }),
  };
  const save = useAction(() => api(existing ? `/api/v1/admin/alumni/${existing.id}` : '/api/v1/admin/alumni', { method: existing ? 'PATCH' : 'POST', body }),
    { success: existing ? 'Record updated.' : 'Alumnus added. An email with a link to set their password was sent.',
      invalidate: [['admin-alumni'], ['admin-alumni-detail'], ['admin-verification']], onSuccess: onClose });
  const e = save.fieldErrors;
  const yb = (batches.data ?? []).filter((b) => String(b.graduation_year) === f.graduation_year);
  const txt = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} error={e[k]}>{(id) => <Input id={id} value={String(f[k])} onChange={(x) => set(k, x.target.value)} {...props} />}</Field>
  );
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={existing ? `Edit ${existing.full_name}` : 'Add an alumnus'}
      description={existing ? 'Administrators can correct verified school details.' : 'They receive an email to set their password; the account activates when they do.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{existing ? 'Save changes' : 'Add alumnus'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {txt('full_name', 'Full name *')}
        {existing ? <Field label="Email">{(id) => <Input id={id} value={f.email} disabled />}</Field> : txt('email', 'Email *', { type: 'email' })}
        {txt('phone', 'Mobile number', { placeholder: '+92 300 1234567' })}
        <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(x) => set('kind', x.target.value)}><option value="alumni">Alumnus</option><option value="student">Current student</option></Select>}</Field>
        <Field label="Admission year" error={e.admission_year}>{(id) => <Select id={id} value={f.admission_year} onChange={(x) => set('admission_year', x.target.value)}>
          <option value="">—</option>{yearsRange(1960, new Date().getFullYear()).map((y) => <option key={y}>{y}</option>)}</Select>}</Field>
        <Field label="Graduation year *" error={e.graduation_year}>{(id) => <Select id={id} value={f.graduation_year} onChange={(x) => { set('graduation_year', x.target.value); set('batch_id', ''); }}>
          <option value="">—</option>{yearsRange(1960, new Date().getFullYear() + 12).map((y) => <option key={y}>{y}</option>)}</Select>}</Field>
        <Field label="Batch" error={e.batch_id}>{(id) => <Select id={id} value={f.batch_id} onChange={(x) => set('batch_id', x.target.value)} disabled={!yb.length}>
          <option value="">{yb.length ? 'Select…' : 'No batch for this year'}</option>{yb.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        {txt('class_name', 'Class / section')}
        {txt('registration_no', 'Registration number')}
        {txt('date_of_birth', 'Date of birth', { type: 'date' })}
        {txt('city', 'City')}
        <Field label="Country" error={e.country}>{(id) => (<><Input id={id} list="adm-countries" value={f.country} onChange={(x) => set('country', x.target.value)} />
          <datalist id="adm-countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist></>)}</Field>
        {txt('designation', 'Designation')}
        {txt('organization', 'Organisation')}
        {existing && <Field label="Industry">{(id) => <Select id={id} value={f.industry} onChange={(x) => set('industry', x.target.value)}><option value="">—</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select>}</Field>}
        {!existing && can('verification.approve') && <div className="sm:col-span-2"><Checkbox checked={f.verified} onCheckedChange={(v) => set('verified', v)} label="Mark as verified (I have confirmed this person studied at the school)" /></div>}
      </div>
    </Dialog>
  );
}

// ── reported profiles ───────────────────────────────────────────────────────
type Report = { id: string; user_id: string; user_name: string; user_email: string; reporter: string | null; reason: string; details: string | null;
  status: string; resolution_note: string | null; created_at: string; resolved_at: string | null };
const REASONS: Record<string, string> = { fake: 'Fake profile', impersonation: 'Impersonation', inappropriate: 'Inappropriate content', spam: 'Spam', other: 'Other' };

function Reports() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-reports', status, page], queryFn: () => api<Paged<Report>>(`/api/v1/admin/profile-reports${qs({ status, page })}`), placeholderData: keepPreviousData });
  const resolve = useAction(({ id, s }: { id: string; s: string }) => api(`/api/v1/admin/profile-reports/${id}/resolve`, { method: 'POST', body: { status: s } }),
    { success: 'Report closed.', invalidate: [['admin-reports']] });
  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
          <option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></Select>
        <p className="text-sm text-ink-muted">To act on a profile, open it, then deactivate the account in User Management if needed.</p>
      </div>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id}
        empty={<EmptyState icon={Flag} title={status === 'open' ? 'No open reports' : 'Nothing here'} />}
        columns={[
          { key: 'who', header: 'Reported profile', cell: (r) => <button className="text-left" onClick={() => setOpen(r.user_id)}><p className="font-medium text-primary hover:underline">{r.user_name}</p><p className="text-xs text-ink-muted">{r.user_email}</p></button> },
          { key: 'reason', header: 'Reason', cell: (r) => <div className="max-w-xs"><Badge tone="danger">{REASONS[r.reason] ?? r.reason}</Badge>{r.details && <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{r.details}</p>}</div> },
          { key: 'by', header: 'Reported by', hideOnMobile: true, cell: (r) => <span className="text-ink-muted">{r.reporter ?? '—'} · {timeAgo(r.created_at)}</span> },
          { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => r.status === 'open' && can('alumni.edit') && (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: r.id, s: 'resolved' })}><Check />Resolved</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Dismiss report?', description: 'Use this when no action is needed.' })) resolve.mutate({ id: r.id, s: 'dismissed' }); }}>Dismiss</Button>
            </div>) },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      {open && <AlumniDetailDialog id={open} onClose={() => setOpen(null)} canEdit={can('alumni.edit')} />}
    </Card>
  );
}

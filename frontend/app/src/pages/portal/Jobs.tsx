import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, BookmarkCheck, Briefcase, Building2, Clock, Download, ExternalLink, FileText, GraduationCap, Handshake, Mail, MapPin,
  Plus, Search, Send, Upload, Users } from 'lucide-react';
import { api, ApiError, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { cn, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { RichText, type Author } from '@/components/community';

export type Job = {
  id: string; title: string; organization: string; employment_type: string; location: string; remote: boolean; category: string | null; category_id: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; experience: string | null; skills: string[]; deadline: string | null;
  is_referral: boolean; status: string; employer: { id: string; name: string; logo: string | null; verified: boolean } | null; posted_by: Author | null;
  approved_at: string | null; created_at: string; is_new: boolean; saved: boolean; my_application: { id: string; status: string } | null; is_mine: boolean; closed: boolean;
  description?: string; apply_url?: string | null; apply_email?: string | null; apply_in_portal?: boolean; rejection_reason?: string | null; views?: number; application_count?: number;
};
type Resume = { id: string; title: string; is_default: boolean; filename: string | null; size: number | null; created_at: string };
type App = { id: string; job_id: string; status: string; cover_letter: string | null; resume_id: string | null; applicant: Author | null; created_at: string;
  updated_at: string; job?: { id: string; title: string; organization: string; status: string }; poster_note?: string | null; email?: string };

export const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', contract: 'Contract',
  temporary: 'Temporary', volunteer: 'Volunteer' };
const APP_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = { submitted: 'neutral', reviewed: 'primary', shortlisted: 'warning',
  rejected: 'danger', hired: 'success', withdrawn: 'neutral' };
const salary = (j: Job) => (j.salary_min || j.salary_max
  ? `${j.salary_currency ?? ''} ${[j.salary_min, j.salary_max].filter(Boolean).map((n) => n!.toLocaleString()).join(' – ')}`.trim() : null);

function Logo({ j, size = 48 }: { j: Job; size?: number }) {
  return j.employer?.logo ? <img src={j.employer.logo} alt="" className="shrink-0 rounded-btn border border-line object-contain" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-btn bg-primary-soft font-heading font-semibold text-primary" style={{ width: size, height: size }}>{j.organization.slice(0, 2).toUpperCase()}</span>;
}

export function JobRow({ j }: { j: Job }) {
  const save = useAction(() => api(`/api/v1/jobs/${j.id}/save`, { method: j.saved ? 'DELETE' : 'PUT' }), { invalidate: [['jobs'], ['job', j.id]] });
  return (
    <div className="flex gap-4 px-4 py-4">
      <Logo j={j} />
      <div className="min-w-0 flex-1">
        <Link to={`/portal/jobs/${j.id}`} className="font-heading text-[15px] font-semibold text-ink hover:text-primary">{j.title}</Link>
        <p className="text-sm text-ink">{j.organization} · {j.location}{j.remote && ' · Remote'}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span>{TYPE_LABEL[j.employment_type]}</span>{j.experience && <span>{j.experience}</span>}{salary(j) && <span>{salary(j)}</span>}
          {j.deadline && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Apply by {fmtDate(j.deadline)}</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {j.is_new && <Badge tone="primary">New</Badge>}{j.is_referral && <Badge tone="success"><Handshake className="h-3 w-3" />Alumni referral</Badge>}
          {j.my_application && <Badge tone={APP_TONE[j.my_application.status]} className="capitalize">Applied · {j.my_application.status}</Badge>}
        </div>
      </div>
      <Button size="icon" variant="ghost" aria-label={j.saved ? 'Remove from saved' : 'Save job'} aria-pressed={j.saved} onClick={() => save.mutate(undefined)}>
        {j.saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}</Button>
    </div>
  );
}

export function JobsPage() {
  const { tab = 'browse' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Job Opportunities" description="Jobs, internships and referrals from the alumni network."
        actions={can('portal.jobs.post') && <Button asChild><Link to="/portal/jobs/post"><Plus />Post a job</Link></Button>} />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'browse' ? '/portal/jobs' : `/portal/jobs/tab/${v}`)}
        tabs={[{ value: 'browse', label: 'Browse' }, { value: 'saved', label: 'Saved' }, { value: 'applications', label: 'My applications' },
          ...(can('portal.jobs.post') ? [{ value: 'postings', label: 'My postings' }] : []), { value: 'resources', label: 'Career resources' }]}><span /></Tabs>
      <div className="mt-5">
        {tab === 'applications' ? <MyApplications /> : tab === 'postings' ? <MyPostings /> : tab === 'resources' ? <Resources /> : <Browse saved={tab === 'saved'} />}
      </div>
    </>
  );
}

function Browse({ saved }: { saved: boolean }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [referral, setReferral] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const dl = useDebounced(location);
  const params = { q: dq, type, category, location: dl, referral: referral || undefined, saved: saved || undefined, page, page_size: 15 };
  const list = useQuery({ queryKey: ['jobs', params], queryFn: () => api<Paged<Job>>(`/api/v1/jobs${qs(params)}`), placeholderData: keepPreviousData });
  const cats = useQuery({ queryKey: ['job-categories'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/jobs/categories'), staleTime: 300_000 });
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search jobs" placeholder="Search jobs, company, skills…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} className="pl-9" /></div>
        <Select aria-label="Job type" value={type} onChange={(e) => reset(() => setType(e.target.value))} className="md:w-40">
          <option value="">Any type</option>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Industry" value={category} onChange={(e) => reset(() => setCategory(e.target.value))} className="md:w-48">
          <option value="">Any industry</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input aria-label="Location" placeholder="Location" value={location} onChange={(e) => reset(() => setLocation(e.target.value))} className="md:w-36" />
        <div className="md:col-span-4"><Checkbox checked={referral} onCheckedChange={(v) => reset(() => setReferral(v))} label="Only alumni referrals" /></div>
      </div>
      {list.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        : !list.data?.data.length ? <EmptyState icon={Briefcase} title={saved ? 'No saved jobs' : 'No jobs found'} description={saved ? 'Tap the bookmark on a job to save it.' : 'Try fewer filters, or check back soon.'} />
        : <div className="divide-y divide-line">{list.data.data.map((j) => <JobRow key={j.id} j={j} />)}</div>}
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

export function JobPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [applying, setApplying] = useState(false);
  const q = useQuery({ queryKey: ['job', id], queryFn: () => get<Job>(`/api/v1/jobs/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const save = useAction(() => api(`/api/v1/jobs/${id}/save`, { method: q.data?.saved ? 'DELETE' : 'PUT' }), { invalidate: [['job', id], ['jobs']] });
  const j = q.data;
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!j) return <Card><EmptyState icon={Briefcase} title="Job not found" action={<Button asChild variant="outline"><Link to="/portal/jobs">All jobs</Link></Button>} /></Card>;
  return (
    <>
      <Link to="/portal/jobs" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Jobs</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="flex gap-4"><Logo j={j} size={64} />
              <div className="min-w-0"><h1 className="font-heading text-xl font-semibold text-ink">{j.title}</h1>
                <p className="text-ink">{j.organization}{j.employer?.verified && <Badge tone="success" className="ml-2">Verified employer</Badge>}</p>
                <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-muted"><span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{j.location}{j.remote && ' · Remote'}</span>
                  <span>{TYPE_LABEL[j.employment_type]}</span>{j.category && <span>{j.category}</span>}</p></div></div>
            {j.is_mine && j.status !== 'approved' && (
              <Alert tone={j.status === 'rejected' ? 'danger' : 'info'} className="mt-4" title={j.status === 'pending' ? 'Waiting for review by the career office' : j.status === 'rejected' ? 'Not approved' : 'Closed'}>
                {j.rejection_reason ?? (j.status === 'pending' ? 'It will be listed once approved.' : undefined)}</Alert>
            )}
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-ink-muted">Experience</dt><dd className="font-medium text-ink">{j.experience ?? '—'}</dd></div>
              <div><dt className="text-ink-muted">Salary</dt><dd className="font-medium text-ink">{salary(j) ?? 'Not stated'}</dd></div>
              <div><dt className="text-ink-muted">Apply by</dt><dd className="font-medium text-ink">{j.deadline ? fmtDate(j.deadline) : 'Open'}</dd></div>
            </dl>
            {j.skills.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{j.skills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}</div>}
          </Card>
          <Card><CardHeader title="Job description" /><div className="p-5"><RichText text={j.description ?? ''} /></div></Card>
        </div>
        <aside className="space-y-4">
          <Card className="space-y-3 p-5">
            {j.my_application ? <Alert tone="success" title="You applied">Status: <span className="capitalize">{j.my_application.status}</span>. <Link to="/portal/jobs/tab/applications" className="text-primary underline">My applications</Link></Alert>
              : j.closed ? <Alert tone="info">This job is closed to new applications.</Alert>
              : j.is_mine ? <Button asChild className="w-full"><Link to={`/portal/jobs/${j.id}/applications`}><Users />Applications ({j.application_count ?? 0})</Link></Button>
              : (<>
                {j.apply_in_portal && can('portal.jobs.apply') && <Button className="w-full" onClick={() => setApplying(true)}><Send />Apply now</Button>}
                {j.apply_url && <Button asChild variant="outline" className="w-full"><a href={j.apply_url} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink />Apply on the employer's site</a></Button>}
                {j.apply_email && <Button asChild variant="outline" className="w-full"><a href={`mailto:${j.apply_email}?subject=${encodeURIComponent(`Application: ${j.title}`)}`}><Mail />Apply by email</a></Button>}
                {!can('portal.jobs.apply') && j.apply_in_portal && <Alert tone="info">Applying through the portal is open to verified members.</Alert>}
              </>)}
            <Button variant="ghost" className="w-full" onClick={() => save.mutate(undefined)}>{j.saved ? <><BookmarkCheck className="text-primary" />Saved</> : <><Bookmark />Save job</>}</Button>
            {j.is_mine && <Button asChild variant="outline" className="w-full"><Link to={`/portal/jobs/post/${j.id}`}>Edit job</Link></Button>}
          </Card>
          {j.posted_by && (
            <Card className="p-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">{j.is_referral ? 'Referral offered by' : 'Posted by'}</p>
              <Link to={`/portal/alumni/${j.posted_by.id}`} className="flex items-center gap-3"><Avatar name={j.posted_by.full_name} src={photoUrl(j.posted_by.photo, 80)} size={40} />
                <span><span className="block font-medium text-ink">{j.posted_by.full_name}</span><span className="text-xs text-ink-muted">{j.posted_by.batch ?? ''}</span></span></Link>
              <p className="mt-3 text-xs text-ink-muted">Posted {timeAgo(j.approved_at ?? j.created_at)}</p>
            </Card>
          )}
        </aside>
      </div>
      {applying && <ApplyDialog j={j} onClose={() => setApplying(false)} />}
    </>
  );
}

function ApplyDialog({ j, onClose }: { j: Job; onClose: () => void }) {
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => get<Resume[]>('/api/v1/jobs/resumes/mine') });
  const [resume, setResume] = useState<string | null>(null);
  const [letter, setLetter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction((f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('title', f.name.replace(/\.[^.]+$/, '').slice(0, 120)); return api<{ data: Resume }>('/api/v1/jobs/resumes', { method: 'POST', body: fd }); },
    { success: 'CV uploaded.', invalidate: [['resumes']], onSuccess: (r) => setResume(r.data.id) });
  const chosen = resume ?? resumes.data?.find((r) => r.is_default)?.id ?? null;
  const apply = useAction(() => api(`/api/v1/jobs/${j.id}/apply`, { method: 'POST', body: { resume_id: chosen, cover_letter: letter || null } }),
    { success: 'Application sent. You can follow its status under My applications.', invalidate: [['job', j.id], ['jobs']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={`Apply: ${j.title}`} description={`${j.organization} · ${j.location}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={apply.isPending} onClick={() => apply.mutate(undefined)}><Send />Send application</Button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">CV</legend>
          {resumes.data?.length ? (
            <div className="space-y-2">{resumes.data.map((r) => (
              <label key={r.id} className={cn('flex cursor-pointer items-center gap-3 rounded-card border p-3', chosen === r.id ? 'border-primary bg-primary-soft/50' : 'border-line')}>
                <input type="radio" name="cv" checked={chosen === r.id} onChange={() => setResume(r.id)} />
                <FileText className="h-5 w-5 text-ink-muted" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{r.title}</span><span className="text-xs text-ink-muted">{r.filename}</span></span>
              </label>))}</div>
          ) : <p className="text-sm text-ink-muted">No CV uploaded yet — CVs are private and shared only with employers you apply to.</p>}
          <Button variant="outline" size="sm" className="mt-2" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload />Upload a CV</Button>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
        </fieldset>
        <Field label="Cover letter (optional)">{(id) => <Textarea id={id} value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={5000} className="min-h-[140px]" />}</Field>
      </div>
    </Dialog>
  );
}

function MyApplications() {
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['my-applications'], queryFn: () => get<App[]>('/api/v1/jobs/applications/mine') });
  const withdraw = useAction((id: string) => api(`/api/v1/jobs/applications/${id}/withdraw`, { method: 'POST' }), { success: 'Application withdrawn.', invalidate: [['my-applications'], ['jobs']] });
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => get<Resume[]>('/api/v1/jobs/resumes/mine') });
  const del = useAction((id: string) => api(`/api/v1/jobs/resumes/${id}`, { method: 'DELETE' }), { success: 'CV deleted.', invalidate: [['resumes']] });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="My applications" icon={Send} />
        {q.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !q.data?.length ? <EmptyState icon={Send} title="No applications yet" description="Jobs you apply for through the portal appear here with their status." /> : (
          <ul className="divide-y divide-line">{q.data.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><Link to={`/portal/jobs/${a.job_id}`} className="font-medium text-ink hover:text-primary">{a.job?.title}</Link>
                <p className="text-sm text-ink-muted">{a.job?.organization} · applied {fmtDate(a.created_at)} · updated {timeAgo(a.updated_at)}</p></div>
              <Badge tone={APP_TONE[a.status]} className="capitalize">{a.status}</Badge>
              {!['withdrawn', 'hired', 'rejected'].includes(a.status) && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Withdraw this application?', confirmLabel: 'Withdraw', danger: true })) withdraw.mutate(a.id); }}>Withdraw</Button>}
            </li>))}</ul>
        )}
      </Card>
      <Card>
        <CardHeader title="My CVs" icon={FileText} description="Private — only employers you apply to can open them." />
        {!resumes.data?.length ? <p className="p-5 text-sm text-ink-muted">Upload a CV when you apply for a job.</p> : (
          <ul className="divide-y divide-line">{resumes.data.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-5 py-3 text-sm">
              <button className="min-w-0 flex-1 truncate text-left text-ink hover:text-primary" onClick={() => download(`/api/v1/jobs/resumes/${r.id}/file`, r.filename ?? 'cv.pdf')}>{r.title}</button>
              {r.is_default && <Badge>Default</Badge>}
              <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>Delete</Button>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}

function MyPostings() {
  const q = useQuery({ queryKey: ['my-jobs'], queryFn: () => get<Job[]>('/api/v1/jobs/mine') });
  const emps = useQuery({ queryKey: ['my-employers'], queryFn: () => get<{ id: string; name: string; status: string; rejection_reason: string | null }[]>('/api/v1/jobs/employers/mine') });
  const [registering, setRegistering] = useState(false);
  const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = { pending: 'warning', approved: 'success', rejected: 'danger', closed: 'neutral' };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Jobs I posted" icon={Briefcase} action={<Button asChild size="sm"><Link to="/portal/jobs/post"><Plus />Post a job</Link></Button>} />
        {!q.data?.length ? <EmptyState icon={Briefcase} title="No postings yet" description="Share openings at your organisation or offer a referral to fellow alumni." /> : (
          <ul className="divide-y divide-line">{q.data.map((j) => (
            <li key={j.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><Link to={`/portal/jobs/${j.id}`} className="font-medium text-ink hover:text-primary">{j.title}</Link>
                <p className="text-sm text-ink-muted">{j.organization} · {j.views ?? 0} views</p>
                {j.status === 'rejected' && <p className="text-xs text-danger">{j.rejection_reason}</p>}</div>
              <Badge tone={STATUS_TONE[j.status]} className="capitalize">{j.status}</Badge>
              <Button asChild size="sm" variant="outline"><Link to={`/portal/jobs/${j.id}/applications`}><Users />{j.application_count ?? 0}</Link></Button>
            </li>))}</ul>
        )}
      </Card>
      <Card>
        <CardHeader title="My organisations" icon={Building2} action={<Button size="sm" variant="outline" onClick={() => setRegistering(true)}><Plus />Register</Button>} />
        {!emps.data?.length ? <p className="p-5 text-sm text-ink-muted">Register your organisation to post as a verified employer.</p> : (
          <ul className="divide-y divide-line">{emps.data.map((e) => (
            <li key={e.id} className="px-5 py-3 text-sm"><span className="font-medium text-ink">{e.name}</span> <Badge tone={STATUS_TONE[e.status]} className="ml-1 capitalize">{e.status}</Badge>
              {e.rejection_reason && <p className="text-xs text-danger">{e.rejection_reason}</p>}</li>))}</ul>
        )}
      </Card>
      {registering && <EmployerDialog onClose={() => setRegistering(false)} />}
    </div>
  );
}

function EmployerDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', website: '', industry: '', description: '' });
  const save = useAction(() => api('/api/v1/jobs/employers', { method: 'POST', body: { ...f, website: f.website || null, industry: f.industry || null } }),
    { success: 'Submitted. The career office will review your organisation.', invalidate: [['my-employers']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Register an organisation"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate(undefined)}>Submit</Button></>}>
      <div className="space-y-3">
        {(['name', 'website', 'industry'] as const).map((k) => <Field key={k} label={k === 'name' ? 'Organisation name' : k[0]!.toUpperCase() + k.slice(1)} required={k === 'name'} error={save.fieldErrors[k]}>
          {(id) => <Input id={id} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
        <Field label="About">{(id) => <Textarea id={id} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function PostJobPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = useQuery({ queryKey: ['job', id], queryFn: () => get<Job>(`/api/v1/jobs/${id}`), enabled: !!id });
  const cats = useQuery({ queryKey: ['job-categories'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/jobs/categories') });
  const emps = useQuery({ queryKey: ['my-employers'], queryFn: () => get<{ id: string; name: string; status: string }[]>('/api/v1/jobs/employers/mine') });
  if (id && !existing.data) return <Skeleton className="h-96 rounded-card" />;
  return <JobForm key={id ?? 'new'} job={existing.data} cats={cats.data ?? []} emps={(emps.data ?? []).filter((e) => e.status === 'approved')} onDone={(jid) => nav(`/portal/jobs/${jid}`)} />;
}

function JobForm({ job, cats, emps, onDone }: { job?: Job; cats: { id: string; name: string }[]; emps: { id: string; name: string }[]; onDone: (id: string) => void }) {
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState({
    title: s(job?.title), organization: s(job?.organization), employer_id: s(job?.employer?.id), category_id: s(job?.category_id), employment_type: job?.employment_type ?? 'full_time',
    location: s(job?.location), remote: job?.remote ?? false, salary_min: s(job?.salary_min), salary_max: s(job?.salary_max), salary_currency: job?.salary_currency ?? 'PKR',
    experience: s(job?.experience), skills: job?.skills.join(', ') ?? '', description: s(job?.description), deadline: s(job?.deadline), apply_url: s(job?.apply_url),
    apply_email: s(job?.apply_email), apply_in_portal: job?.apply_in_portal ?? true, is_referral: job?.is_referral ?? false,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v ? Number(v) : null);
  const o = (v: string) => v.trim() || null;
  const save = useAction(() => api<{ data: Job }>(job ? `/api/v1/jobs/${job.id}` : '/api/v1/jobs', { method: job ? 'PUT' : 'POST', body: {
    ...f, employer_id: o(f.employer_id), category_id: o(f.category_id), salary_min: n(f.salary_min), salary_max: n(f.salary_max),
    salary_currency: f.salary_min || f.salary_max ? f.salary_currency : null, experience: o(f.experience), deadline: o(f.deadline),
    apply_url: o(f.apply_url), apply_email: o(f.apply_email), skills: f.skills.split(',').map((x) => x.trim()).filter(Boolean),
  } }), { success: (r) => (r.data.status === 'approved' ? 'Job published.' : 'Job submitted. It will be listed after review.'), invalidate: [['my-jobs'], ['jobs']], onSuccess: (r) => onDone(r.data.id) });
  const e = save.fieldErrors;
  const txt = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} error={e[k]} className={props.wide ? 'sm:col-span-2' : ''}>{(id) => <Input id={id} value={String(f[k])} onChange={(x) => set(k, x.target.value)} {...{ ...props, wide: undefined }} />}</Field>
  );
  return (
    <>
      <PageHeader title={job ? 'Edit job' : 'Post a job'} breadcrumb={<Link to="/portal/jobs" className="hover:text-ink">Jobs</Link>}
        description="The career office reviews new and edited jobs before they are listed." />
      <Card className="max-w-3xl">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {save.error && <Alert tone="danger" className="sm:col-span-2">{save.error.message}</Alert>}
          {txt('title', 'Job title *', { wide: true })}
          {txt('organization', 'Organisation *')}
          {emps.length > 0 ? <Field label="Post as">{(id) => <Select id={id} value={f.employer_id} onChange={(x) => set('employer_id', x.target.value)}><option value="">Myself (alumni referral / posting)</option>{emps.map((m) => <option key={m.id} value={m.id}>{m.name} (verified employer)</option>)}</Select>}</Field> : <span />}
          <Field label="Job type">{(id) => <Select id={id} value={f.employment_type} onChange={(x) => set('employment_type', x.target.value)}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Industry">{(id) => <Select id={id} value={f.category_id} onChange={(x) => set('category_id', x.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          {txt('location', 'Location *', { placeholder: 'City, country' })}
          {txt('experience', 'Experience', { placeholder: 'e.g. 2–4 years' })}
          <div className="sm:col-span-2"><Checkbox checked={f.remote} onCheckedChange={(v) => set('remote', v)} label="Remote work possible" /></div>
          {txt('salary_min', 'Salary from', { type: 'number', min: 0 })}{txt('salary_max', 'Salary to', { type: 'number', min: 0 })}
          {txt('skills', 'Skills', { placeholder: 'Comma-separated, e.g. Python, SQL', wide: true })}
          <Field label="Description *" error={e.description} className="sm:col-span-2" hint="At least 30 characters.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(x) => set('description', x.target.value)} className="min-h-[200px]" maxLength={20000} />}</Field>
          {txt('deadline', 'Application deadline', { type: 'date', min: new Date().toISOString().slice(0, 10) })}
          <span />
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[13px] font-medium text-ink">How to apply</p>
            <Checkbox checked={f.apply_in_portal} onCheckedChange={(v) => set('apply_in_portal', v)} label="Through the portal (CV + cover letter, you review applications here)" />
            <Checkbox checked={f.is_referral} onCheckedChange={(v) => set('is_referral', v)} label="I can refer suitable alumni (alumni referral)" />
          </div>
          {txt('apply_url', 'External application link', { placeholder: 'https://…' })}{txt('apply_email', 'Application email', { type: 'email' })}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button asChild variant="outline"><Link to="/portal/jobs/tab/postings">Cancel</Link></Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{job ? 'Save changes' : 'Submit job'}</Button>
        </div>
      </Card>
    </>
  );
}

export function JobApplicationsPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['job-apps', id], queryFn: () => api<{ data: App[]; meta: { job: Job } }>(`/api/v1/jobs/${id}/applications`) });
  const update = useAction(({ app, status }: { app: string; status: string }) => api(`/api/v1/jobs/applications/${app}`, { method: 'PATCH', body: { status } }),
    { success: 'Status updated — the applicant was notified.', invalidate: [['job-apps', id]] });
  const job = q.data?.meta.job;
  return (
    <>
      <PageHeader title={job ? `Applications: ${job.title}` : 'Applications'} breadcrumb={<Link to="/portal/jobs/tab/postings" className="hover:text-ink">My postings</Link>} />
      <Card>
        {q.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !q.data?.data.length ? <EmptyState icon={Users} title="No applications yet" /> : (
          <ul className="divide-y divide-line">{q.data.data.map((a) => (
            <li key={a.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex items-center gap-3"><Avatar name={a.applicant?.full_name} src={photoUrl(a.applicant?.photo ?? null, 80)} size={40} />
                  <div><Link to={`/portal/alumni/${a.applicant?.id}`} className="font-medium text-ink hover:text-primary">{a.applicant?.full_name}</Link>
                    <p className="text-xs text-ink-muted">{[a.applicant?.headline, a.applicant?.batch].filter(Boolean).join(' · ')} · applied {fmtDateTime(a.created_at)}</p></div></div>
                {a.cover_letter && <p className="mt-2 whitespace-pre-line text-sm text-ink">{a.cover_letter}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.resume_id && <Button size="sm" variant="outline" onClick={() => download(`/api/v1/jobs/applications/${a.id}/resume`, `${a.applicant?.full_name ?? 'applicant'} CV`)}><Download />CV</Button>}
                  {a.email && <Button asChild size="sm" variant="ghost"><a href={`mailto:${a.email}`}><Mail />Email</a></Button>}
                </div>
              </div>
              <Select aria-label={`Status of ${a.applicant?.full_name}`} value={a.status} onChange={(e) => update.mutate({ app: a.id, status: e.target.value })} className="h-9 lg:w-40">
                {['submitted', 'reviewed', 'shortlisted', 'rejected', 'hired'].map((s) => <option key={s} value={s} className="capitalize">{s[0]!.toUpperCase() + s.slice(1)}</option>)}
              </Select>
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}

function Resources() {
  const q = useQuery({ queryKey: ['career-resources'], queryFn: () => get<{ id: string; title: string; category: string; description: string; url: string | null; file: string | null }[]>('/api/v1/jobs/resources') });
  const groups = Object.entries((q.data ?? []).reduce<Record<string, NonNullable<typeof q.data>>>((acc, r) => { (acc[r.category] ??= []).push(r); return acc; }, {}));
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!groups.length) return <Card><EmptyState icon={GraduationCap} title="No career resources yet" description="Guides, templates and links from the career office appear here." /></Card>;
  return (
    <div className="grid gap-5 md:grid-cols-2">{groups.map(([cat, items]) => (
      <Card key={cat}><CardHeader title={cat} icon={GraduationCap} />
        <ul className="divide-y divide-line">{items.map((r) => (
          <li key={r.id} className="px-5 py-3"><a href={r.url ?? r.file ?? '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium text-primary hover:underline">{r.title}<ExternalLink className="h-3.5 w-3.5" /></a>
            {r.description && <p className="text-sm text-ink-muted">{r.description}</p>}</li>))}</ul></Card>
    ))}</div>
  );
}

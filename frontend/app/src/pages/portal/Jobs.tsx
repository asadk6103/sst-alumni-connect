import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bell, Bookmark, BookmarkCheck, Briefcase, Building2, CheckCircle2, Clock, Copy, Download, ExternalLink, FileText, Gift,
  GraduationCap, Handshake, HeartPulse, Laptop, Loader2, Mail, MapPin, MessageSquareText, MoreHorizontal, Plus, Search, Send, Share2, Sparkles, Target, Trash2,
  TrendingUp, Upload, UserPlus, Users, Wallet, X } from 'lucide-react';
import { api, ApiError, download, get, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { CustomFieldsForm, ExtraFields, customErrors, useCustomFields, type CustomValues, type ExtraField } from '@/components/customFields';
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import { VerifiedBadge } from '@/components/alumni';
import { RichText, SectionCard, type Author } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

type Employer = { id: string; name: string; logo: string | null; verified: boolean; industry?: string | null; description?: string; website?: string | null; employees?: string | null; headquarters?: string | null };
export type Job = {
  id: string; title: string; organization: string; employment_type: string; location: string; remote: boolean; category: string | null; category_id: string | null;
  salary_min: number | null; salary_max: number | null; salary_currency: string | null; experience: string | null; skills: string[]; deadline: string | null;
  is_referral: boolean; status: string; employer: Employer | null; posted_by: Author | null;
  approved_at: string | null; created_at: string; is_new: boolean; saved: boolean; my_application: { id: string; status: string } | null; is_mine: boolean; closed: boolean;
  description?: string; apply_url?: string | null; apply_email?: string | null; apply_in_portal?: boolean; rejection_reason?: string | null; views?: number; application_count?: number;
  custom_fields?: Record<string, unknown> | null; extra_fields?: ExtraField[]; responsibilities?: string[]; requirements?: string[]; benefits?: string[];
};
type Resume = { id: string; title: string; is_default: boolean; filename: string | null; size: number | null; created_at: string };
type App = { id: string; job_id: string; status: string; cover_letter: string | null; resume_id: string | null; applicant: Author | null; created_at: string;
  updated_at: string; job?: { id: string; title: string; organization: string; status: string }; poster_note?: string | null; email?: string };
type Referral = { id: string; job: { id: string; title: string; organization: string } | null; referrer: Author | null; candidate: Author | null; candidate_name: string;
  candidate_email: string | null; note: string; status: string; created_at: string };
type JobAlert = { id: string; q: string | null; employment_type: string | null; location: string | null; remote: boolean | null; created_at: string };

export const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', contract: 'Contract',
  temporary: 'Temporary', volunteer: 'Volunteer' };
const APP_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = { submitted: 'neutral', reviewed: 'primary', shortlisted: 'warning',
  rejected: 'danger', hired: 'success', withdrawn: 'neutral' };
const salary = (j: Job) => (j.salary_min || j.salary_max
  ? `${j.salary_currency ?? ''} ${[j.salary_min, j.salary_max].filter(Boolean).map((n) => n!.toLocaleString()).join(' – ')}`.trim() : null);
const FILTERS: { k: string; l: string; icon: typeof Briefcase }[] = [
  { k: '', l: 'All Jobs', icon: Briefcase }, { k: 'full_time', l: 'Full-time', icon: Clock }, { k: 'part_time', l: 'Part-time', icon: Clock },
  { k: 'internship', l: 'Internship', icon: GraduationCap }, { k: 'remote', l: 'Remote', icon: Laptop }, { k: 'onsite', l: 'On-site', icon: Building2 },
];
const BENEFIT_ICONS: [RegExp, typeof Wallet][] = [[/salary|pay|bonus/i, Wallet], [/health|medical|insurance/i, HeartPulse], [/flex|remote|hybrid/i, Laptop],
  [/learn|growth|training|course/i, TrendingUp], [/alumni|network/i, Users]];
const benefitIcon = (b: string) => BENEFIT_ICONS.find(([r]) => r.test(b))?.[1] ?? Gift;

function Logo({ j, size = 48 }: { j: Job; size?: number }) {
  return j.employer?.logo ? <img src={j.employer.logo} alt="" className="shrink-0 rounded-btn border border-line bg-white object-contain" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-btn bg-primary-soft font-heading font-semibold text-primary" style={{ width: size, height: size }}>{j.organization.slice(0, 2).toUpperCase()}</span>;
}

function useSave(j: Job) {
  return useAction(() => api(`/api/v1/jobs/${j.id}/save`, { method: j.saved ? 'DELETE' : 'PUT' }),
    { success: j.saved ? 'Removed from saved jobs.' : 'Job saved.', invalidate: [['jobs'], ['job', j.id], ['job-activity']] });
}

export function JobRow({ j }: { j: Job }) {
  const save = useSave(j);
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <Logo j={j} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Link to={`/portal/jobs/${j.id}`} className="font-heading text-[16px] font-semibold text-ink hover:text-primary">{j.title}</Link>
            <Badge tone="primary">{TYPE_LABEL[j.employment_type]}</Badge>{j.is_new && <Badge tone="success">New</Badge>}{j.is_referral && <Badge tone="navy"><Handshake className="h-3 w-3" />Referral</Badge>}</div>
          <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-ink">{j.organization}{j.employer?.verified && <VerifiedBadge />}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location}{j.remote && ' · Remote'}</span>
            {j.experience && <span className="flex items-center gap-1"><Target className="h-3.5 w-3.5" />{j.experience}</span>}
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Posted {timeAgo(j.approved_at ?? j.created_at)}</span></p>
          {j.my_application && <Badge tone={APP_TONE[j.my_application.status]} className="mt-2 capitalize">Applied · {j.my_application.status}</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
        <Button size="icon" variant="outline" className="h-9 w-9" aria-label={j.saved ? 'Remove from saved' : 'Save job'} aria-pressed={j.saved} onClick={() => save.mutate(undefined)}>
          {j.saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}</Button>
        <Button asChild variant="link" className="ms-auto px-0 sm:ms-0"><Link to={`/portal/jobs/${j.id}`}>View Details<ArrowRight className="rtl:rotate-180" /></Link></Button>
      </div>
    </Card>
  );
}

const SECTIONS: Record<string, string> = { saved: 'Saved Jobs', applications: 'My Applications', alerts: 'Job Alerts', postings: 'My Postings', referrals: 'My Referrals', resources: 'Career Resources' };

export function JobsPage() {
  const { tab } = useParams();
  const { can } = useAuth();
  const site = useSite();
  const [sp, setSp] = useSearchParams();
  const [refer, setRefer] = useState(sp.get('refer') === '1');
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  const section = tab && SECTIONS[tab] ? tab : null;
  return (
    <PortalPage aside={<JobsAside onRefer={() => setRefer(true)} />}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>{section ? <Link to="/portal/jobs" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />Jobs & Opportunities</Link> : <p className="text-sm text-ink-muted">Jobs & Opportunities</p>}
          <h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">{section ? SECTIONS[section] : 'Jobs & Opportunities'}</h1>
          {!section && <p className="mt-1 text-ink-muted">Discover career opportunities, refer fellow alumni and grow your professional network.</p>}</div>
        {can('portal.jobs.post') && <Button asChild><Link to="/portal/jobs/post"><Plus />Post a Job</Link></Button>}
      </div>
      {!section && (
        <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-navy via-[#173a5e] to-primary">
          {banner && <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-y-0 end-0 h-full w-3/5 object-cover opacity-80 [mask-image:linear-gradient(to_right,transparent,black_50%)]" />}
          <div className="relative max-w-md px-6 py-8 text-white sm:px-8">
            <h2 className="font-heading text-2xl font-semibold sm:text-[28px]">Alumni Career Network</h2>
            <p className="mt-2 text-white/90">Jobs • Referrals • Internships • Career Growth</p>
            <Button variant="outline" className="mt-4 border-0 bg-white text-navy hover:bg-white/90" onClick={() => document.getElementById('job-search')?.focus()}>Explore Jobs<ArrowRight className="rtl:rotate-180" /></Button>
          </div>
        </div>
      )}
      {section === 'applications' ? <MyApplications /> : section === 'postings' ? <MyPostings /> : section === 'resources' ? <Resources />
        : section === 'alerts' ? <Alerts /> : section === 'referrals' ? <MyReferrals /> : <Browse saved={section === 'saved'} />}
      {refer && <ReferDialog onClose={() => { setRefer(false); if (sp.get('refer')) { sp.delete('refer'); setSp(sp, { replace: true }); } }} />}
    </PortalPage>
  );
}

function Browse({ saved }: { saved: boolean }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const dq = useDebounced(q.trim());
  const params = new URLSearchParams({ page_size: '15', ...(dq ? { q: dq } : {}), ...(saved ? { saved: 'true' } : {}),
    ...(filter === 'remote' ? { remote: 'true' } : filter === 'onsite' ? { remote: 'false' } : filter ? { type: filter } : {}) });
  const list = useInfiniteQuery({
    queryKey: ['jobs', params.toString()], initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<Job>>(`/api/v1/jobs?${params}&page=${pageParam}`),
    getNextPageParam: (last) => (last.meta.page < last.meta.pages ? last.meta.page + 1 : undefined),
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }, { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const total = list.data?.pages[0]?.meta.total ?? 0;
  return (
    <>
      <div className="relative"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
        <Input id="job-search" aria-label="Search jobs" placeholder="Search jobs by title, company or keyword…" value={q} onChange={(e) => setQ(e.target.value)} className="h-12 ps-12 text-[15px]" /></div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{FILTERS.map((f) => (
        <button key={f.l} onClick={() => setFilter(f.k)} aria-pressed={filter === f.k}
          className={cn('flex flex-col items-center gap-1 rounded-card border px-2 py-3 text-sm font-medium', filter === f.k ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink hover:border-primary/50')}>
          <f.icon className="h-5 w-5" />{f.l}</button>))}</div>
      <p className="font-heading text-lg font-semibold text-ink">{total.toLocaleString()} Job Opportunit{total === 1 ? 'y' : 'ies'}</p>
      {list.isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div>
        : !rows.length ? <Card><EmptyState icon={Briefcase} title={saved ? 'No saved jobs' : 'No jobs found'} description={saved ? 'Tap the bookmark on a job to save it.' : 'Try another search or filter — or create a job alert.'} /></Card>
          : <div className="space-y-3">{rows.map((j) => <JobRow key={j.id} j={j} />)}</div>}
      <div ref={sentinel} />
      {list.isFetchingNextPage && <p className="flex items-center justify-center gap-2 py-3 text-sm text-ink-muted"><Loader2 className="h-5 w-5 animate-spin text-primary" />Loading more opportunities…</p>}
    </>
  );
}

function JobsAside({ onRefer }: { onRefer: () => void }) {
  const { can } = useAuth();
  const act = useQuery({ queryKey: ['job-activity'], queryFn: () => get<{ applications: number; saved: number; alerts: number; referrals: number }>('/api/v1/jobs/activity') });
  const res = useQuery({ queryKey: ['career-resources'], queryFn: () => get<{ id: string; title: string; url: string | null; file: string | null }[]>('/api/v1/jobs/resources'), staleTime: 300_000 });
  const tiles: [string, string, number | undefined, typeof Send][] = [['applications', 'Applications', act.data?.applications, Send], ['saved', 'Saved Jobs', act.data?.saved, Bookmark], ['alerts', 'Job Alerts', act.data?.alerts, Bell]];
  return (
    <>
      <SectionCard title="My Job Activity" icon={Briefcase}>
        <div className="grid grid-cols-3 gap-2">{tiles.map(([k, l, v, I]) => (
          <Link key={k} to={`/portal/jobs/tab/${k}`} className="flex flex-col items-center rounded-card border border-line p-2 text-center hover:border-primary/50">
            <I className="h-5 w-5 text-primary" /><span className="mt-1 font-heading text-xl font-semibold text-ink">{v ?? '–'}</span><span className="text-xs text-ink-muted">{l}</span></Link>))}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm"><Link to="/portal/jobs/tab/referrals" className="font-semibold text-primary hover:underline">My referrals ({act.data?.referrals ?? 0})</Link>
          {can('portal.jobs.post') && <Link to="/portal/jobs/tab/postings" className="font-semibold text-primary hover:underline">My postings</Link>}</div>
      </SectionCard>
      {can('portal.jobs.post') && <SectionCard title="Post a Job" icon={Plus}>
        <p className="text-sm text-ink-muted">Hiring? Share openings with SST alumni — the career office reviews each posting.</p>
        <Button asChild className="mt-3 w-full"><Link to="/portal/jobs/post"><Plus />Post a Job</Link></Button></SectionCard>}
      <SectionCard title="Career Resources" icon={GraduationCap}>
        <ul className="space-y-2 text-sm">
          {(res.data ?? []).slice(0, 4).map((r) => <li key={r.id}><a href={r.url ?? r.file ?? '#'} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 text-ink hover:text-primary">{r.title}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a></li>)}
          <li><Link to="/portal/mentorship" className="flex items-center justify-between gap-2 text-ink hover:text-primary">Alumni Mentorship<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></Link></li>
          <li><Link to="/portal/jobs/tab/resources" className="font-semibold text-primary hover:underline">All career resources</Link></li>
        </ul>
      </SectionCard>
      <SectionCard title="Refer a Candidate" icon={Handshake}>
        <p className="text-sm text-ink-muted">Know someone who would be a great fit? Recommend a fellow alumnus — or anyone — for an open role.</p>
        <Button variant="outline" className="mt-3 w-full border-primary/50 text-primary" onClick={onRefer}><Plus />Make a Referral</Button>
      </SectionCard>
    </>
  );
}

export function JobPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [applying, setApplying] = useState(false);
  const [referring, setReferring] = useState(false);
  const q = useQuery({ queryKey: ['job', id], queryFn: () => get<Job>(`/api/v1/jobs/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const similar = useQuery({ queryKey: ['job-similar', id], queryFn: () => get<Job[]>(`/api/v1/jobs/${id}/similar`), enabled: !!q.data });
  const j = q.data;
  const save = useSave(j ?? ({ id: id ?? '', saved: false } as Job));
  const message = useAction(() => api<{ data: { id: string } }>('/api/v1/messages/conversations/direct', { method: 'POST', body: { user_id: j?.posted_by?.id } }), { onSuccess: (r) => nav(`/portal/messages/${r.data.id}`) });
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!j) return <Card><EmptyState icon={Briefcase} title="Job not found" action={<Button asChild variant="outline"><Link to="/portal/jobs">All jobs</Link></Button>} /></Card>;
  const copy = () => { navigator.clipboard?.writeText(`${location.origin}/portal/jobs/${j.id}`); toast.success('Job link copied.'); };
  const e = j.employer;
  const aside = (
    <>
      <Card className="space-y-2 p-4">
        {j.my_application ? <Alert tone="success" title="You applied">Status: <span className="capitalize">{j.my_application.status}</span>. <Link to="/portal/jobs/tab/applications" className="text-primary underline">My applications</Link></Alert>
          : j.closed ? <Alert tone="info">This job is closed to new applications.</Alert>
            : j.is_mine ? <Button asChild className="w-full"><Link to={`/portal/jobs/${j.id}/applications`}><Users />Applications ({j.application_count ?? 0})</Link></Button>
              : (<>
                {j.apply_in_portal && can('portal.jobs.apply') && <Button className="h-11 w-full" onClick={() => setApplying(true)}>Apply Now<ExternalLink /></Button>}
                {j.apply_url && <Button asChild variant={j.apply_in_portal ? 'outline' : 'primary'} className="w-full"><a href={j.apply_url} target="_blank" rel="noopener noreferrer nofollow">{j.apply_in_portal ? "Apply on the employer's site" : 'Apply Now'}<ExternalLink /></a></Button>}
                {j.apply_email && <Button asChild variant="outline" className="w-full"><a href={`mailto:${j.apply_email}?subject=${encodeURIComponent(`Application: ${j.title}`)}`}><Mail />Apply by email</a></Button>}
                {!can('portal.jobs.apply') && j.apply_in_portal && <Alert tone="info">Applying through the portal is open to verified members.</Alert>}
              </>)}
        {!j.closed && j.status === 'approved' && <Button variant="outline" className="w-full" onClick={() => setReferring(true)}><UserPlus />Refer a Candidate</Button>}
        {j.is_mine && <Button asChild variant="ghost" className="w-full"><Link to={`/portal/jobs/post/${j.id}`}>Edit job</Link></Button>}
      </Card>
      <SectionCard title="About the Company" icon={Building2}>
        <div className="flex items-center gap-3"><Logo j={j} size={48} /><div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold text-ink">{e?.name ?? j.organization}{e?.verified && <VerifiedBadge />}</p>
          {(e?.industry ?? j.category) && <p className="text-sm text-ink-muted">{e?.industry ?? j.category}</p>}</div></div>
        {e?.description && <p className="mt-3 line-clamp-5 text-sm text-ink">{e.description}</p>}
        <dl className="mt-3 space-y-1.5 text-sm">
          {e?.employees && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Employees</dt><dd className="font-medium text-ink">{e.employees}</dd></div>}
          {e?.headquarters && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Headquarters</dt><dd className="text-end font-medium text-ink">{e.headquarters}</dd></div>}
          {e?.website && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Website</dt><dd className="truncate"><a href={e.website.startsWith('http') ? e.website : `https://${e.website}`} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{e.website.replace(/^https?:\/\//, '')}</a></dd></div>}
          {!e && <p className="text-ink-muted">Posted as an individual alumni listing.</p>}
        </dl>
      </SectionCard>
      {j.posted_by && <SectionCard title={j.is_referral ? 'Referral offered by' : 'Posted by an Alumni'} icon={Users}>
        <Link to={`/portal/alumni/${j.posted_by.id}`} className="flex items-center gap-3"><Avatar name={j.posted_by.full_name} src={photoUrl(j.posted_by.photo, 80)} size={46} />
          <span className="min-w-0"><span className="flex items-center gap-1 font-semibold text-ink">{j.posted_by.full_name}{j.posted_by.verified && <VerifiedBadge />}</span>
            <span className="block text-xs text-ink-muted">{j.posted_by.batch}</span>{j.posted_by.headline && <span className="block truncate text-xs text-ink-muted">{j.posted_by.headline}</span>}</span></Link>
        {!j.is_mine && <Button variant="outline" className="mt-3 w-full" loading={message.isPending} onClick={() => message.mutate(undefined)}><MessageSquareText />Message</Button>}
      </SectionCard>}
      {!!similar.data?.length && <SectionCard title="Similar Opportunities" icon={Sparkles}>
        <ul className="space-y-3">{similar.data.map((s) => <li key={s.id}><Link to={`/portal/jobs/${s.id}`} className="group flex items-center gap-3"><Logo j={s} size={40} />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink group-hover:text-primary">{s.title}</span><span className="block truncate text-xs text-ink-muted">{s.organization}</span>
            <Badge tone="primary" className="mt-0.5">{TYPE_LABEL[s.employment_type]}</Badge></span><ArrowRight className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-180" /></Link></li>)}</ul>
      </SectionCard>}
    </>
  );
  const bullets = (items: string[]) => <ul className="space-y-2">{items.map((x, i) => <li key={i} className="flex gap-2.5 text-[15px] text-ink"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />{x}</li>)}</ul>;
  return (
    <PortalPage aside={aside}>
      <nav className="text-sm text-ink-muted"><Link to="/portal/jobs" className="hover:text-ink">Jobs & Opportunities</Link> › <span className="text-ink">Job Details</span></nav>
      <Card className="p-5">
        <div className="flex gap-4"><Logo j={j} size={72} />
          <div className="min-w-0 flex-1"><h1 className="font-heading text-2xl font-semibold text-ink">{j.title}</h1>
            <p className="flex items-center gap-1.5 text-[15px] font-medium text-ink">{j.organization}{e?.verified && <VerifiedBadge />}</p></div>
          <div className="flex shrink-0 items-start gap-2">
            <Button size="icon" variant="outline" aria-label={j.saved ? 'Remove from saved' : 'Save job'} aria-pressed={j.saved} onClick={() => save.mutate(undefined)}>{j.saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}</Button>
            <Button size="icon" variant="outline" aria-label="Share" onClick={copy}><Share2 /></Button>
            <Menu><MenuTrigger asChild><Button size="icon" variant="outline" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
              <MenuContent><MenuItem onSelect={copy}><Copy />Copy link</MenuItem>{!j.closed && <MenuItem onSelect={() => setReferring(true)}><UserPlus />Refer a candidate</MenuItem>}</MenuContent></Menu>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{j.location}{j.remote && ' · Remote'}</span>
          <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{TYPE_LABEL[j.employment_type]}</span>
          {j.experience && <span className="flex items-center gap-1.5"><Target className="h-4 w-4" />{j.experience}</span>}
          <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Posted {timeAgo(j.approved_at ?? j.created_at)}</span>
          {salary(j) && <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4" />{salary(j)}</span>}
          {j.deadline && <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Apply by {fmtDate(j.deadline)}</span>}
        </div>
        {j.is_mine && j.status !== 'approved' && (
          <Alert tone={j.status === 'rejected' ? 'danger' : 'info'} className="mt-4" title={j.status === 'pending' ? 'Waiting for review by the career office' : j.status === 'rejected' ? 'Not approved' : 'Closed'}>
            {j.rejection_reason ?? (j.status === 'pending' ? 'It will be listed once approved.' : undefined)}</Alert>
        )}
      </Card>
      <SectionCard title="Job Overview" icon={FileText}><RichText text={j.description ?? ''} />
        {j.skills.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{j.skills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}</div>}</SectionCard>
      {!!j.responsibilities?.length && <SectionCard title="Key Responsibilities" icon={Target}>{bullets(j.responsibilities)}</SectionCard>}
      {!!j.requirements?.length && <SectionCard title="Requirements" icon={CheckCircle2}>{bullets(j.requirements)}</SectionCard>}
      {!!j.benefits?.length && <SectionCard title="What We Offer" icon={Gift}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{j.benefits.map((b) => { const I = benefitIcon(b); return (
          <div key={b} className="flex flex-col items-center gap-2 rounded-card bg-canvas p-3 text-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-primary"><I className="h-5 w-5" /></span><span className="text-sm font-medium text-ink">{b}</span></div>); })}</div>
      </SectionCard>}
      {!!j.extra_fields?.length && <SectionCard title="More details"><ExtraFields items={j.extra_fields} fileHref={(k) => `/api/v1/custom-fields/job_post/${j.id}/${k}/file`} /></SectionCard>}
      {j.is_mine && <JobReferrals jobId={j.id} />}
      {applying && <ApplyDialog j={j} onClose={() => setApplying(false)} />}
      {referring && <ReferDialog job={j} onClose={() => setReferring(false)} />}
    </PortalPage>
  );
}

function JobReferrals({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ['job-referrals', jobId], queryFn: () => get<Referral[]>(`/api/v1/jobs/${jobId}/referrals`) });
  if (!q.data?.length) return null;
  return (
    <SectionCard title={`Referrals (${q.data.length})`} icon={Handshake}>
      <ul className="divide-y divide-line">{q.data.map((r) => (
        <li key={r.id} className="py-3 first:pt-0 last:pb-0">
          <p className="text-sm"><span className="font-semibold text-ink">{r.candidate ? <Link to={`/portal/alumni/${r.candidate.id}`} className="hover:text-primary">{r.candidate_name}</Link> : r.candidate_name}</span>
            {r.candidate_email && <> · <a href={`mailto:${r.candidate_email}`} className="text-primary hover:underline">{r.candidate_email}</a></>}</p>
          <p className="text-xs text-ink-muted">Referred by {r.referrer?.full_name} · {timeAgo(r.created_at)}</p>
          {r.note && <p className="mt-1 text-sm text-ink">{r.note}</p>}</li>))}</ul>
    </SectionCard>
  );
}

function ReferDialog({ job, onClose }: { job?: Job; onClose: () => void }) {
  const [jobId, setJobId] = useState(job?.id ?? '');
  const [mode, setMode] = useState<'member' | 'outside'>('member');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [person, setPerson] = useState<Author | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const jobs = useQuery({ queryKey: ['jobs', 'refer-pick'], enabled: !job, queryFn: () => get<Job[]>('/api/v1/jobs?page_size=50') });
  const people = useQuery({ queryKey: ['refer-people', dq], enabled: mode === 'member' && dq.length >= 2, queryFn: () => get<Author[]>(`/api/v1/alumni/directory?q=${encodeURIComponent(dq)}&page_size=8`) });
  const send = useAction(() => api(`/api/v1/jobs/${jobId}/referrals`, { method: 'POST', body: mode === 'member' ? { candidate_user_id: person?.id, note } : { candidate_name: name, candidate_email: email, note } }),
    { success: 'Referral sent to the job poster.', invalidate: [['job-activity'], ['my-referrals']], onSuccess: onClose });
  const ok = jobId && (mode === 'member' ? !!person : name.trim().length >= 2 && /.+@.+\..+/.test(email));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Refer a Candidate" description={job ? `${job.title} · ${job.organization}` : 'Recommend someone for an open role.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={send.isPending} onClick={() => send.mutate(undefined)}><Handshake />Send Referral</Button></>}>
      <div className="space-y-4">
        {send.error && !Object.keys(send.fieldErrors).length && <Alert tone="danger">{send.error.message}</Alert>}
        {!job && <Field label="Job">{(id) => <Select id={id} value={jobId} onChange={(x) => setJobId(x.target.value)}><option value="">Choose a job…</option>{(jobs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.title} — {x.organization}</option>)}</Select>}</Field>}
        <div className="flex gap-2">{([['member', 'An SST alumnus'], ['outside', 'Someone else']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} className={cn('flex-1 rounded-btn border px-3 py-2 text-sm font-medium', mode === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink')}>{l}</button>))}</div>
        {mode === 'member' ? (person ? <div className="flex items-center gap-3 rounded-card border border-line p-3"><Avatar name={person.full_name} src={photoUrl(person.photo, 64)} size={36} />
          <span className="flex-1 text-sm font-medium text-ink">{person.full_name}</span><Button size="icon" variant="ghost" aria-label="Change candidate" onClick={() => setPerson(null)}><X /></Button></div> : (
          <div><Input aria-label="Search alumni" placeholder="Search alumni by name…" value={q} onChange={(x) => setQ(x.target.value)} />
            {!!people.data?.length && <ul className="mt-2 divide-y divide-line rounded-card border border-line">{people.data.map((p) => <li key={p.id}><button type="button" onClick={() => setPerson(p)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-canvas">
              <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={28} />{p.full_name}<span className="ms-auto text-xs text-ink-muted">{p.batch}</span></button></li>)}</ul>}</div>))
          : <div className="grid gap-3 sm:grid-cols-2"><Field label="Candidate name">{(id) => <Input id={id} value={name} maxLength={150} onChange={(x) => setName(x.target.value)} />}</Field>
            <Field label="Candidate email" error={send.fieldErrors.candidate_email}>{(id) => <Input id={id} type="email" value={email} onChange={(x) => setEmail(x.target.value)} />}</Field></div>}
        <Field label="Why they are a good fit (optional)">{(id) => <Textarea id={id} value={note} maxLength={1000} onChange={(x) => setNote(x.target.value)} className="min-h-[80px]" />}</Field>
      </div>
    </Dialog>
  );
}

function MyReferrals() {
  const q = useQuery({ queryKey: ['my-referrals'], queryFn: () => get<Referral[]>('/api/v1/jobs/referrals/mine') });
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!q.data?.length) return <Card><EmptyState icon={Handshake} title="No referrals yet" description="Use “Refer a Candidate” on a job to recommend someone." /></Card>;
  return (
    <Card><ul className="divide-y divide-line">{q.data.map((r) => (
      <li key={r.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="font-medium text-ink">{r.candidate_name}</p>
          <p className="text-sm text-ink-muted">for <Link to={`/portal/jobs/${r.job?.id}`} className="text-primary hover:underline">{r.job?.title}</Link> · {r.job?.organization} · {timeAgo(r.created_at)}</p></div>
        <Badge className="capitalize">{r.status}</Badge></li>))}</ul></Card>
  );
}

function Alerts() {
  const [f, setF] = useState({ q: '', employment_type: '', location: '', remote: '' });
  const list = useQuery({ queryKey: ['job-alerts'], queryFn: () => get<JobAlert[]>('/api/v1/jobs/alerts') });
  const inv = [['job-alerts'], ['job-activity']];
  const add = useAction(() => api('/api/v1/jobs/alerts', { method: 'POST', body: { q: f.q || null, employment_type: f.employment_type || null, location: f.location || null, remote: f.remote === '' ? null : f.remote === 'yes' } }),
    { success: 'Job alert created — we will notify you about matching jobs.', invalidate: inv, onSuccess: () => setF({ q: '', employment_type: '', location: '', remote: '' }) });
  const del = useAction((id: string) => api(`/api/v1/jobs/alerts/${id}`, { method: 'DELETE' }), { success: 'Alert deleted.', invalidate: inv });
  const any = f.q || f.employment_type || f.location || f.remote;
  return (
    <>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-ink"><Bell className="h-5 w-5 text-primary" />New job alert</h2>
        <p className="text-sm text-ink-muted">Get a notification as soon as a matching job is listed.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Input aria-label="Keywords" placeholder="Keywords, e.g. engineer" value={f.q} onChange={(x) => setF({ ...f, q: x.target.value })} maxLength={100} />
          <Select aria-label="Alert job type" value={f.employment_type} onChange={(x) => setF({ ...f, employment_type: x.target.value })}><option value="">Any type</option>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input aria-label="Alert location" placeholder="Location" value={f.location} onChange={(x) => setF({ ...f, location: x.target.value })} maxLength={100} />
          <Select aria-label="Work mode" value={f.remote} onChange={(x) => setF({ ...f, remote: x.target.value })}><option value="">Remote or on-site</option><option value="yes">Remote</option><option value="no">On-site</option></Select>
        </div>
        <Button className="mt-3" disabled={!any} loading={add.isPending} onClick={() => add.mutate(undefined)}><Plus />Create Alert</Button>
      </Card>
      {list.isLoading ? <Skeleton className="h-24 rounded-card" /> : !list.data?.length ? <Card><EmptyState icon={Bell} title="No job alerts" description="Create one above." /></Card> : (
        <Card><ul className="divide-y divide-line">{list.data.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-3"><Bell className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-sm text-ink">{[a.q && `“${a.q}”`, a.employment_type && TYPE_LABEL[a.employment_type], a.location, a.remote === true ? 'Remote' : a.remote === false ? 'On-site' : null].filter(Boolean).join(' · ')}</span>
            <span className="hidden text-xs text-ink-muted sm:inline">since {fmtDate(a.created_at)}</span>
            <Button size="icon" variant="ghost" aria-label="Delete alert" onClick={() => del.mutate(a.id)}><Trash2 /></Button></li>))}</ul></Card>
      )}
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
    <div className="space-y-5">
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
    <div className="space-y-5">
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
  const [f, setF] = useState({ name: '', website: '', industry: '', employees: '', headquarters: '', description: '' });
  const save = useAction(() => api('/api/v1/jobs/employers', { method: 'POST', body: { ...f, website: f.website || null, industry: f.industry || null, employees: f.employees || null, headquarters: f.headquarters || null } }),
    { success: 'Submitted. The career office will review your organisation.', invalidate: [['my-employers']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Register an organisation"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate(undefined)}>Submit</Button></>}>
      <div className="space-y-3">
        {(['name', 'website', 'industry', 'employees', 'headquarters'] as const).map((k) => <Field key={k} label={k === 'name' ? 'Organisation name' : k === 'employees' ? 'Employees (e.g. 250+)' : k[0]!.toUpperCase() + k.slice(1)} required={k === 'name'} error={save.fieldErrors[k]}>
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
    responsibilities: (job?.responsibilities ?? []).join('\n'), requirements: (job?.requirements ?? []).join('\n'), benefits: (job?.benefits ?? []).join('\n'),
  });
  const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const defs = useCustomFields('job_post');
  const [extra, setExtra] = useState<CustomValues>(job?.custom_fields ?? {});
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v ? Number(v) : null);
  const o = (v: string) => v.trim() || null;
  const save = useAction(() => api<{ data: Job }>(job ? `/api/v1/jobs/${job.id}` : '/api/v1/jobs', { method: job ? 'PUT' : 'POST', body: {
    ...f, employer_id: o(f.employer_id), category_id: o(f.category_id), salary_min: n(f.salary_min), salary_max: n(f.salary_max),
    salary_currency: f.salary_min || f.salary_max ? f.salary_currency : null, experience: o(f.experience), deadline: o(f.deadline),
    apply_url: o(f.apply_url), apply_email: o(f.apply_email), skills: f.skills.split(',').map((x) => x.trim()).filter(Boolean),
    custom_fields: extra, responsibilities: lines(f.responsibilities), requirements: lines(f.requirements), benefits: lines(f.benefits),
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
          <Field label="Key responsibilities" hint="One per line." className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.responsibilities} onChange={(x) => set('responsibilities', x.target.value)} className="min-h-[100px]" />}</Field>
          <Field label="Requirements" hint="One per line." className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.requirements} onChange={(x) => set('requirements', x.target.value)} className="min-h-[100px]" />}</Field>
          <Field label="What we offer" hint="One benefit per line, e.g. Competitive Salary, Health Insurance, Flexible Work." className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.benefits} onChange={(x) => set('benefits', x.target.value)} className="min-h-[80px]" />}</Field>
          {txt('deadline', 'Application deadline', { type: 'date', min: new Date().toISOString().slice(0, 10) })}
          <span />
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[13px] font-medium text-ink">How to apply</p>
            <Checkbox checked={f.apply_in_portal} onCheckedChange={(v) => set('apply_in_portal', v)} label="Through the portal (CV + cover letter, you review applications here)" />
            <Checkbox checked={f.is_referral} onCheckedChange={(v) => set('is_referral', v)} label="I can refer suitable alumni (alumni referral)" />
          </div>
          {txt('apply_url', 'External application link', { placeholder: 'https://…' })}{txt('apply_email', 'Application email', { type: 'email' })}
          {!!defs.data?.length && <div className="border-t border-line pt-4 sm:col-span-2"><CustomFieldsForm defs={defs.data} value={extra} onChange={setExtra} errors={customErrors(e)} /></div>}
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

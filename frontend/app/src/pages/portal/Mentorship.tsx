import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, Briefcase, CalendarClock, Check, ChevronRight, Compass, Crown, GraduationCap, Handshake, Lightbulb, MessageSquareQuote,
  MoreHorizontal, Plus, Rocket, Search, Star, UserCheck, Users, UsersRound, Video, X } from 'lucide-react';
import { api, ApiError, get, qs, type Paged } from '@/lib/api';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { INDUSTRIES } from '@/lib/countries';
import { pickVariant, useSite } from '@/lib/site';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { CustomFieldsForm, ExtraFields, customErrors, useCustomFields, type CustomValues, type ExtraField } from '@/components/customFields';
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { VerifiedBadge } from '@/components/alumni';
import { SectionCard, type Author } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

export type MentorT = {
  user: Author; status: string; industry: string | null; expertise: string[]; skills: string[]; experience_years: number | null; hours_per_month: number;
  formats: string[]; mentees_students: boolean; mentees_alumni: boolean; max_mentees: number; introduction: string; rating: number | null; reviews: number;
  active_mentees: number; available: boolean; rejection_reason?: string | null; custom_fields?: Record<string, unknown>; extra_fields?: ExtraField[];
  testimonials?: { rating: number; comment: string; from: Author | null; created_at: string }[]; my_request?: { id: string; status: string } | null;
  categories?: string[]; mentee_count?: number; mentoring_since?: string | null;
};
type Req = {
  id: string; mentor: Author | null; mentee: Author | null; topic: string; goals: string; preferred_format: string | null; status: string; response_note: string | null;
  created_at: string; responded_at: string | null; completed_at: string | null; role: 'mentor' | 'mentee'; initiated_by?: 'mentee' | 'mentor'; awaiting_me?: boolean;
  sessions?: { id: string; scheduled_at: string; duration_minutes: number; format: string; location: string | null; agenda: string | null; status: string; outcome: string | null }[];
  feedback?: { mine: { rating: number; comment: string | null } | null; theirs: { rating: number; comment: string | null } | null };
};
type SessionItem = { id: string; scheduled_at: string; duration_minutes: number; format: string; location: string | null; status: string; request_id: string; topic: string; with: Author | null; role: string };
type Mentee = { user: Author; looking: boolean; areas: string[]; goals: string; connected: boolean };
type Summary = { sessions: number; as_mentee: number; as_mentor: number; awaiting: number };
const FORMAT: Record<string, string> = { video: 'Video call', phone: 'Phone', in_person: 'In person', chat: 'Chat' };
const REQ_TONE: Record<string, 'warning' | 'success' | 'neutral' | 'primary' | 'danger'> = { pending: 'warning', accepted: 'success', declined: 'danger', cancelled: 'neutral', completed: 'primary' };
export const MENTOR_CATS: { k: string; l: string; icon: typeof Compass }[] = [
  { k: 'career', l: 'Career Guidance', icon: Compass }, { k: 'higher_studies', l: 'Higher Studies', icon: GraduationCap }, { k: 'industry', l: 'Industry Insights', icon: Lightbulb },
  { k: 'leadership', l: 'Leadership', icon: Crown }, { k: 'entrepreneurship', l: 'Entrepreneurship', icon: Rocket }, { k: 'technology', l: 'Technology & IT', icon: BookOpen },
  { k: 'management', l: 'Management', icon: Briefcase }, { k: 'other', l: 'Other', icon: Star },
];
const catLabel = (k: string) => MENTOR_CATS.find((c) => c.k === k)?.l ?? k;
const years = (since?: string | null) => (since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / (365.25 * 86400000))) : 0);

export function Stars({ value, size = 'h-4 w-4' }: { value: number | null; size?: string }) {
  return <span className="inline-flex" aria-label={value ? `${value} out of 5` : 'No ratings yet'}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn(size, value && n <= Math.round(value) ? 'fill-warning text-warning' : 'text-line')} />)}</span>;
}

/** Compact mentor card (used on the dashboard). */
export function MentorCard({ m, onOpen }: { m: MentorT; onOpen: () => void }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-3">
        <Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 96)} size={52} />
        <div className="min-w-0"><button onClick={onOpen} className="truncate text-start font-heading font-semibold text-ink hover:text-primary">{m.user.full_name}</button>
          <p className="truncate text-xs text-ink-muted">{[m.user.headline, m.user.batch].filter(Boolean).join(' · ')}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">{m.expertise.slice(0, 4).map((x) => <Badge key={x} tone="primary">{x}</Badge>)}</div>
      <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{m.introduction}</p>
      <div className="mt-auto flex items-center justify-between pt-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1"><Stars value={m.rating} />{m.reviews ? `(${m.reviews})` : ''}</span>
        {m.available ? <Badge tone="success">Available</Badge> : <Badge>Fully booked</Badge>}
      </div>
      <Button className="mt-3" variant="outline" onClick={onOpen}>View profile</Button>
    </Card>
  );
}

function MentorRow({ m, onOpen, onRequest }: { m: MentorT; onOpen: () => void; onRequest: () => void }) {
  const nav = useNavigate();
  const y = years(m.mentoring_since);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 120)} size={64} />
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="flex items-center gap-1.5 text-start font-heading text-[16px] font-semibold text-ink hover:text-primary">{m.user.full_name}{m.user.verified && <VerifiedBadge />}</button>
          <p className="text-sm text-ink-muted">{m.user.batch}</p>
          {m.user.headline && <p className="truncate text-sm text-ink">{m.user.headline}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">{m.expertise.slice(0, 3).map((x) => <Badge key={x} tone="primary">{x}</Badge>)}</div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-muted sm:w-36 sm:flex-col sm:items-start">
        <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />{m.mentee_count ?? 0} mentee{m.mentee_count === 1 ? '' : 's'}</span>
        <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{y >= 1 ? `${y}+ year${y > 1 ? 's' : ''} mentoring` : m.experience_years ? `${m.experience_years} yrs experience` : 'New mentor'}</span>
        {m.rating && <span className="flex items-center gap-1"><Stars value={m.rating} size="h-3.5 w-3.5" />({m.reviews})</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {m.my_request ? <Button variant="outline" onClick={() => nav(`/portal/mentorship/requests/${m.my_request!.id}`)}>Requested</Button>
          : <Button variant="outline" className="border-primary/50 text-primary" disabled={!m.available} onClick={onRequest}>{m.available ? 'Request Mentorship' : 'Fully booked'}</Button>}
        <Menu>
          <MenuTrigger asChild><Button size="icon" variant="outline" aria-label={`More actions for ${m.user.full_name}`}><MoreHorizontal /></Button></MenuTrigger>
          <MenuContent><MenuItem onSelect={onOpen}><UserCheck />Mentor profile</MenuItem><MenuItem onSelect={() => nav(`/portal/alumni/${m.user.id}`)}><Users />Alumni profile</MenuItem></MenuContent>
        </Menu>
      </div>
    </Card>
  );
}

type Me = { mentor: MentorT | null; counts: Record<string, number>; can_apply: boolean; can_request: boolean };

export function MentorshipPage() {
  const { tab = 'find' } = useParams();
  const nav = useNavigate();
  const site = useSite();
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category') ?? '';
  const setCategory = (c: string) => { const n = new URLSearchParams(sp); if (c) n.set('category', c); else n.delete('category'); setSp(n, { replace: true }); };
  const me = useQuery({ queryKey: ['mentorship-me'], queryFn: () => get<Me>('/api/v1/mentorship/me') });
  const sum = useQuery({ queryKey: ['mentorship-summary'], queryFn: () => get<Summary>('/api/v1/mentorship/summary') });
  const [menteeOpen, setMenteeOpen] = useState(false);
  const isMentor = me.data?.mentor?.status === 'approved' || me.data?.mentor?.status === 'paused';
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  const go = (t: string) => nav(t === 'find' ? `/portal/mentorship${category ? `?category=${category}` : ''}` : `/portal/mentorship/tab/${t}`);
  const tabs = [{ k: 'find', l: 'Find a Mentor' }, ...(isMentor ? [{ k: 'mentees', l: 'Find a Mentee' }] : []), { k: 'mine', l: 'My Mentorships' }, { k: 'sessions', l: 'Sessions' },
    { k: 'requests', l: 'Mentorship Requests', badge: sum.data?.awaiting }];
  return (
    <PortalPage aside={<MentorshipAside sum={sum.data} category={category} onCategory={(c) => { setCategory(c === category ? '' : c); if (tab !== 'find') nav(`/portal/mentorship?category=${c}`); }} onMentee={() => setMenteeOpen(true)} />}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-ink-muted">Mentorship</p><h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Mentorship</h1>
          <p className="mt-1 text-ink-muted">Connect with experienced alumni, get career guidance and give back by mentoring others.</p></div>
        {me.data?.can_apply && <Button onClick={() => go('become')}>{me.data.mentor ? <><UserCheck />My Mentor Profile</> : <><Plus />Become a Mentor</>}</Button>}
      </div>
      {tab !== 'become' && (
        <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-[#5b2bb5] via-[#6d3fd0] to-primary">
          {banner && <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-y-0 end-0 h-full w-3/5 object-cover opacity-80 [mask-image:linear-gradient(to_right,transparent,black_50%)]" />}
          <div className="relative max-w-md px-6 py-8 text-white sm:px-8">
            <h2 className="font-heading text-2xl font-semibold sm:text-[28px]">Alumni Mentorship Program</h2>
            <p className="mt-2 text-white/90">Learn • Guide • Grow • Give Back</p>
            <Button variant="outline" className="mt-4 border-0 bg-white text-navy hover:bg-white/90" onClick={() => { go('find'); setTimeout(() => document.getElementById('mentor-search')?.focus(), 50); }}>Find a Mentor<ArrowRight className="rtl:rotate-180" /></Button>
          </div>
        </div>
      )}
      {tab !== 'become' && <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">{tabs.map((t) => (
        <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => go(t.k)}
          className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-[15px] font-medium', tab === t.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>
          {t.l}{!!t.badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-white">{t.badge}</span>}</button>))}</div>}
      {tab === 'mine' ? <MyMentorships /> : tab === 'become' ? <><Link to="/portal/mentorship" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />Mentorship</Link><BecomeMentor mentor={me.data?.mentor ?? null} /></>
        : tab === 'sessions' ? <Sessions /> : tab === 'requests' ? <Requests /> : tab === 'mentees' && isMentor ? <FindMentee />
          : <FindMentor canRequest={!!me.data?.can_request} category={category} onCategory={setCategory} />}
      {menteeOpen && <MenteeDialog onClose={() => setMenteeOpen(false)} />}
    </PortalPage>
  );
}

function FindMentor({ canRequest, category, onCategory }: { canRequest: boolean; category: string; onCategory: (c: string) => void }) {
  const [q, setQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ id: string; ask: boolean } | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, industry, category, page, page_size: 10 };
  const list = useQuery({ queryKey: ['mentors', params], queryFn: () => api<Paged<MentorT> & { meta: { industries: string[] } }>(`/api/v1/mentorship/mentors${qs(params)}`), placeholderData: keepPreviousData });
  const tiles = [{ k: '', l: 'Mentors', icon: Users }, ...MENTOR_CATS.slice(0, 5)];
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <Input id="mentor-search" aria-label="Search mentors" placeholder="Search by name, area of expertise, company or keyword…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-12 ps-12 text-[15px]" /></div>
        <Select aria-label="Industry" value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }} className="h-12 sm:w-52">
          <option value="">Any industry</option>{(list.data?.meta.industries.length ? list.data.meta.industries : INDUSTRIES).map((i) => <option key={i}>{i}</option>)}</Select>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{tiles.map((t) => (
        <button key={t.l} onClick={() => { onCategory(t.k); setPage(1); }} aria-pressed={category === t.k}
          className={cn('flex flex-col items-center gap-1 rounded-card border px-2 py-3 text-center text-sm font-medium', category === t.k ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink hover:border-primary/50')}>
          <t.icon className="h-5 w-5" />{t.l}</button>))}</div>
      <h2 className="font-heading text-lg font-semibold text-ink">{category ? catLabel(category) : 'Recommended Mentors'}</h2>
      {list.isLoading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div>
        : !list.data?.data.length ? <Card><EmptyState icon={Users} title="No mentors found" description="Try a different search or category — new mentors join regularly." /></Card>
          : <div className="space-y-3">{list.data.data.map((m) => <MentorRow key={m.user.id} m={m} onOpen={() => setOpen({ id: m.user.id, ask: false })} onRequest={() => setOpen({ id: m.user.id, ask: true })} />)}</div>}
      {list.data && list.data.meta.pages > 1 && <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
      {open && <MentorDialog id={open.id} startAsking={open.ask} canRequest={canRequest} onClose={() => setOpen(null)} />}
    </>
  );
}

export function MentorDialog({ id, canRequest, onClose, startAsking = false }: { id: string; canRequest: boolean; onClose: () => void; startAsking?: boolean }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['mentor', id], queryFn: () => get<MentorT>(`/api/v1/mentorship/mentors/${id}`) });
  const [asking, setAsking] = useState(startAsking && canRequest);
  const [f, setF] = useState({ topic: '', goals: '', preferred_format: '' });
  const send = useAction(() => api<{ data: Req }>('/api/v1/mentorship/requests', { method: 'POST', body: { mentor_id: id, ...f, preferred_format: f.preferred_format || null } }),
    { success: 'Request sent. You will be emailed when the mentor replies.', invalidate: [['mentor', id], ['mentorships'], ['mentors'], ['mentorship-summary']], onSuccess: (r) => { onClose(); nav(`/portal/mentorship/requests/${r.data.id}`); } });
  const m = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={asking ? `Request mentorship from ${m?.user.full_name ?? ''}` : m?.user.full_name ?? 'Mentor'}
      footer={m && (m.my_request ? <Button asChild><Link to={`/portal/mentorship/requests/${m.my_request.id}`}>Open my request ({m.my_request.status})</Link></Button>
        : asking ? <><Button variant="outline" onClick={() => setAsking(false)}>Mentor profile</Button><Button loading={send.isPending} disabled={f.topic.length < 3 || f.goals.length < 20} onClick={() => send.mutate(undefined)}>Send request</Button></>
          : canRequest && m.available ? <Button onClick={() => setAsking(true)}>Request Mentorship</Button>
            : <span className="text-sm text-ink-muted">{m.available ? 'Requesting mentorship is not available for your account.' : 'This mentor has no free places right now.'}</span>)}>
      {!m ? <Skeleton className="h-64" /> : asking ? (
        <div className="space-y-4">
          <Field label="What would you like help with?" required error={send.fieldErrors.topic}>{(i) => <Input id={i} value={f.topic} maxLength={200} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="e.g. Choosing a university for computer science" />}</Field>
          <Field label="Your goals" required hint="At least 20 characters — what would make this mentorship a success?" error={send.fieldErrors.goals}>{(i, d) => <Textarea id={i} aria-describedby={d} value={f.goals} maxLength={3000} onChange={(e) => setF({ ...f, goals: e.target.value })} />}</Field>
          <Field label="Preferred format">{(i) => <Select id={i} value={f.preferred_format} onChange={(e) => setF({ ...f, preferred_format: e.target.value })}><option value="">No preference</option>{m.formats.map((x) => <option key={x} value={x}>{FORMAT[x]}</option>)}</Select>}</Field>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4"><Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 160)} size={72} />
            <div><p className="text-sm text-ink">{[m.user.headline, m.industry].filter(Boolean).join(' · ')}</p><p className="text-xs text-ink-muted">{m.user.batch}{m.experience_years ? ` · ${m.experience_years} years' experience` : ''}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Stars value={m.rating} />{m.reviews} review{m.reviews === 1 ? '' : 's'}</p></div></div>
          <p className="whitespace-pre-line text-sm text-ink">{m.introduction}</p>
          <ExtraFields items={m.extra_fields} />
          <div><p className="mb-1 text-xs font-medium uppercase text-ink-muted">Areas of expertise</p><div className="flex flex-wrap gap-1">{m.expertise.map((x) => <Badge key={x} tone="primary">{x}</Badge>)}</div></div>
          {!!m.categories?.length && <div><p className="mb-1 text-xs font-medium uppercase text-ink-muted">Mentors in</p><div className="flex flex-wrap gap-1">{m.categories.map((x) => <Badge key={x}>{catLabel(x)}</Badge>)}</div></div>}
          <p className="text-sm text-ink-muted">{m.formats.map((x) => FORMAT[x]).join(' · ')} · about {m.hours_per_month} h/month · mentors {[m.mentees_students && 'students', m.mentees_alumni && 'alumni'].filter(Boolean).join(' and ')}</p>
          {!!m.testimonials?.length && <div className="space-y-2">{m.testimonials.map((t, i) => (
            <blockquote key={i} className="rounded-card bg-canvas p-3 text-sm"><Stars value={t.rating} size="h-3.5 w-3.5" /><p className="mt-1 text-ink">“{t.comment}”</p><p className="mt-1 text-xs text-ink-muted">— {t.from?.full_name}</p></blockquote>))}</div>}
        </div>
      )}
    </Dialog>
  );
}

function FindMentee() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const dq = useDebounced(q.trim());
  const [offering, setOffering] = useState<Mentee | null>(null);
  const list = useQuery({ queryKey: ['mentees', dq, cat], queryFn: () => get<Mentee[]>(`/api/v1/mentorship/mentees${qs({ q: dq || null, category: cat || null })}`) });
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search mentees" placeholder="Search members looking for a mentor…" value={q} onChange={(e) => setQ(e.target.value)} className="h-12 ps-12" /></div>
        <Select aria-label="Area" value={cat} onChange={(e) => setCat(e.target.value)} className="h-12 sm:w-52"><option value="">Any area</option>{MENTOR_CATS.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}</Select>
      </div>
      {list.isLoading ? <Skeleton className="h-40 rounded-card" /> : !list.data?.length ? <Card><EmptyState icon={GraduationCap} title="No one is looking right now" description="Members who ask for a mentor appear here." /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2">{list.data.map((m) => (
          <Card key={m.user.id} className="flex flex-col p-4">
            <Link to={`/portal/alumni/${m.user.id}`} className="flex items-center gap-3"><Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 96)} size={48} />
              <span className="min-w-0"><span className="flex items-center gap-1 font-semibold text-ink">{m.user.full_name}{m.user.verified && <VerifiedBadge />}</span><span className="block truncate text-sm text-ink-muted">{m.user.headline ?? m.user.batch}</span></span></Link>
            <div className="mt-3 flex flex-wrap gap-1">{m.areas.map((a) => <Badge key={a} tone="primary">{catLabel(a)}</Badge>)}</div>
            {m.goals && <p className="mt-2 line-clamp-3 text-sm text-ink">{m.goals}</p>}
            <div className="mt-auto pt-3">{m.connected ? <Badge tone="success">Mentorship open</Badge> : <Button variant="outline" className="border-primary/50 text-primary" onClick={() => setOffering(m)}><Handshake />Offer Mentorship</Button>}</div>
          </Card>))}</div>
      )}
      {offering && <OfferDialog m={offering} onClose={() => setOffering(null)} />}
    </>
  );
}

function OfferDialog({ m, onClose }: { m: Mentee; onClose: () => void }) {
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const send = useAction(() => api(`/api/v1/mentorship/mentees/${m.user.id}/offer`, { method: 'POST', body: { topic, note } }),
    { success: `Offer sent to ${m.user.full_name}.`, invalidate: [['mentees'], ['mentorships'], ['mentorship-summary']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Offer mentorship to ${m.user.full_name}`} description="They can accept or decline. You can schedule sessions once they accept."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={topic.trim().length < 3} loading={send.isPending} onClick={() => send.mutate(undefined)}><Handshake />Send Offer</Button></>}>
      <div className="space-y-4">
        {send.error && <Alert tone="danger">{send.error.message}</Alert>}
        <Field label="Topic" required>{(id) => <Input id={id} value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Breaking into product management" />}</Field>
        <Field label="Message (optional)">{(id) => <Textarea id={id} value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function MenteeDialog({ onClose }: { onClose: () => void }) {
  const cur = useQuery({ queryKey: ['mentee-me'], queryFn: () => get<{ looking: boolean; areas: string[]; goals: string } | null>('/api/v1/mentorship/mentee/me') });
  if (cur.isLoading) return null;
  return <MenteeForm init={cur.data ?? null} onClose={onClose} />;
}

function MenteeForm({ init, onClose }: { init: { looking: boolean; areas: string[]; goals: string } | null; onClose: () => void }) {
  const [looking, setLooking] = useState(init?.looking ?? true);
  const [areas, setAreas] = useState<string[]>(init?.areas ?? []);
  const [goals, setGoals] = useState(init?.goals ?? '');
  const save = useAction(() => api('/api/v1/mentorship/mentee/me', { method: 'PUT', body: { looking, areas, goals } }),
    { success: looking ? 'Mentors can now find you and offer mentorship.' : 'You are no longer listed for mentors.', invalidate: [['mentee-me']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Looking for a mentor?" description="Let approved mentors find you and offer mentorship."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-4">
        <Checkbox checked={looking} onCheckedChange={setLooking} label="List me for mentors" />
        <div><p className="mb-1.5 text-[13px] font-medium text-ink">Areas I want help with</p>
          <div className="flex flex-wrap gap-2">{MENTOR_CATS.map((c) => <button key={c.k} type="button" aria-pressed={areas.includes(c.k)} onClick={() => setAreas(areas.includes(c.k) ? areas.filter((x) => x !== c.k) : [...areas, c.k])}
            className={cn('rounded-full border px-3 py-1 text-sm', areas.includes(c.k) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink')}>{c.l}</button>)}</div></div>
        <Field label="My goals">{(id) => <Textarea id={id} value={goals} maxLength={2000} onChange={(e) => setGoals(e.target.value)} placeholder="What would you like to achieve with a mentor?" />}</Field>
      </div>
    </Dialog>
  );
}

function Sessions() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const list = useQuery({ queryKey: ['mentorship-sessions', scope], queryFn: () => get<SessionItem[]>(`/api/v1/mentorship/sessions?scope=${scope}`) });
  return (
    <Card>
      <div className="flex gap-1 border-b border-line p-3">{(['upcoming', 'past'] as const).map((s) => <button key={s} onClick={() => setScope(s)} className={cn('rounded-btn px-3 py-1.5 text-sm font-medium capitalize', scope === s ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas')}>{s}</button>)}</div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !list.data?.length ? <EmptyState icon={CalendarClock} title={scope === 'upcoming' ? 'No upcoming sessions' : 'No past sessions'} description="Sessions are scheduled from an active mentorship." /> : (
        <ul className="divide-y divide-line">{list.data.map((s) => <li key={s.id}><SessionLink s={s} /></li>)}</ul>
      )}
    </Card>
  );
}

function SessionLink({ s, compact }: { s: SessionItem; compact?: boolean }) {
  const d = new Date(s.scheduled_at);
  return (
    <Link to={`/portal/mentorship/requests/${s.request_id}`} className={cn('flex items-center gap-3 hover:bg-canvas', compact ? 'py-1' : 'px-4 py-3')}>
      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-btn bg-primary-soft text-primary"><span className="text-[10px] font-semibold uppercase">{d.toLocaleString(undefined, { month: 'short' })}</span><span className="font-heading text-lg font-semibold leading-none">{d.getDate()}</span></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{s.topic}</span>
        <span className="block truncate text-xs text-ink-muted">{d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {s.role === 'mentor' ? 'with' : 'mentor'} {s.with?.full_name}</span>
        <span className="flex items-center gap-1 text-xs text-ink-muted"><Video className="h-3 w-3" />{FORMAT[s.format] ?? s.format}{s.status !== 'scheduled' && ` · ${s.status}`}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-180" />
    </Link>
  );
}

function Requests() {
  const q = useQuery({ queryKey: ['mentorships', 'pending'], queryFn: () => get<Req[]>('/api/v1/mentorship/requests?status=pending') });
  const respond = useAction(({ id, accept }: { id: string; accept: boolean }) => api(`/api/v1/mentorship/requests/${id}/respond`, { method: 'POST', body: { accept } }),
    { success: (r) => ((r as { data: Req }).data.status === 'accepted' ? 'Accepted — schedule your first session.' : 'Declined.'), invalidate: [['mentorships'], ['mentorship-summary'], ['mentorship-me']] });
  const waiting = (q.data ?? []).filter((r) => r.awaiting_me);
  const sent = (q.data ?? []).filter((r) => !r.awaiting_me);
  const row = (r: Req, actions: boolean) => {
    const other = r.role === 'mentor' ? r.mentee : r.mentor;
    return (
      <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <Link to={`/portal/mentorship/requests/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3"><Avatar name={other?.full_name} src={photoUrl(other?.photo ?? null, 80)} size={44} />
          <span className="min-w-0"><span className="block truncate font-semibold text-ink">{other?.full_name}</span>
            <span className="block truncate text-sm text-ink-muted">{r.initiated_by === 'mentor' ? (r.role === 'mentee' ? 'Offers to mentor you' : 'Your offer') : r.role === 'mentor' ? 'Asks you for mentorship' : 'Your request'} · {r.topic}</span>
            <span className="text-xs text-ink-muted">{fmtDate(r.created_at)}</span></span></Link>
        {actions ? <div className="flex gap-2"><Button size="sm" onClick={() => respond.mutate({ id: r.id, accept: true })}><Check />Accept</Button><Button size="sm" variant="outline" onClick={() => respond.mutate({ id: r.id, accept: false })}><X />Decline</Button></div>
          : <Badge tone="warning">Waiting</Badge>}
      </li>
    );
  };
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  return (
    <>
      <Card><CardHeader title={`Waiting for your reply (${waiting.length})`} icon={Handshake} />
        {!waiting.length ? <p className="p-5 text-sm text-ink-muted">Nothing to answer right now.</p> : <ul className="divide-y divide-line">{waiting.map((r) => row(r, true))}</ul>}</Card>
      <Card><CardHeader title={`Sent by you (${sent.length})`} icon={MessageSquareQuote} />
        {!sent.length ? <p className="p-5 text-sm text-ink-muted">No open requests or offers.</p> : <ul className="divide-y divide-line">{sent.map((r) => row(r, false))}</ul>}</Card>
    </>
  );
}

function MentorshipAside({ sum, category, onCategory, onMentee }: { sum?: Summary; category: string; onCategory: (c: string) => void; onMentee: () => void }) {
  const nav = useNavigate();
  const up = useQuery({ queryKey: ['mentorship-sessions', 'upcoming'], queryFn: () => get<SessionItem[]>('/api/v1/mentorship/sessions?scope=upcoming') });
  return (
    <>
      <SectionCard title="My Mentorship" icon={Handshake}>
        <div className="grid grid-cols-3 gap-2 text-center">{([['Mentor Sessions', sum?.sessions, 'sessions'], ['As a Mentee', sum?.as_mentee, 'mine'], ['As a Mentor', sum?.as_mentor, 'mine']] as const).map(([l, v, t]) => (
          <button key={l} onClick={() => nav(`/portal/mentorship/tab/${t}`)} className="rounded-card border border-line p-2 hover:border-primary/50"><p className="font-heading text-xl font-semibold text-ink">{v ?? '–'}</p><p className="text-xs text-ink-muted">{l}</p></button>))}</div>
      </SectionCard>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 bg-primary-soft/70 p-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface text-primary"><GraduationCap className="h-7 w-7" /></span>
          <div><p className="font-heading font-semibold text-ink">Request a Mentor</p><p className="text-sm text-ink-muted">Get guidance from alumni who have been there.</p></div></div>
        <div className="space-y-2 p-4"><Button className="w-full" onClick={() => { nav('/portal/mentorship'); setTimeout(() => document.getElementById('mentor-search')?.focus(), 50); }}>Find a Mentor</Button>
          <Button variant="outline" className="w-full" onClick={onMentee}>Let mentors find me</Button></div>
      </Card>
      <SectionCard title="Mentorship Categories" icon={Compass}>
        <div className="flex flex-wrap gap-2">{MENTOR_CATS.map((c) => <button key={c.k} onClick={() => onCategory(c.k)} aria-pressed={category === c.k}
          className={cn('rounded-full border px-3 py-1.5 text-sm', category === c.k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink hover:border-primary/50')}>{c.l}</button>)}</div>
      </SectionCard>
      <SectionCard title="Upcoming Sessions" icon={CalendarClock}>
        {up.isLoading ? <Skeleton className="h-20" /> : !up.data?.length ? <p className="text-sm text-ink-muted">No sessions scheduled.</p> : <div className="space-y-2">{up.data.slice(0, 3).map((s) => <SessionLink key={s.id} s={s} compact />)}</div>}
      </SectionCard>
    </>
  );
}

function MyMentorships() {
  const [role, setRole] = useState('all');
  const q = useQuery({ queryKey: ['mentorships', role], queryFn: () => get<Req[]>(`/api/v1/mentorship/requests?role=${role}`) });
  return (
    <Card>
      <div className="border-b border-line px-4 pt-2"><Tabs value={role} onValueChange={setRole} tabs={[{ value: 'all', label: 'All' }, { value: 'mentee', label: 'As mentee' }, { value: 'mentor', label: 'As mentor' }]}><span /></Tabs></div>
      {q.isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !q.data?.length ? <EmptyState icon={UsersRound} title="No mentorships yet" description="Find a mentor, or become one." /> : (
        <ul className="divide-y divide-line">{q.data.map((r) => {
          const other = r.role === 'mentor' ? r.mentee : r.mentor;
          return (
            <li key={r.id}><Link to={`/portal/mentorship/requests/${r.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-canvas">
              <Avatar name={other?.full_name} src={photoUrl(other?.photo ?? null, 80)} size={42} />
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{r.topic}</p>
                <p className="truncate text-xs text-ink-muted">{r.role === 'mentor' ? 'Mentee' : 'Mentor'}: {other?.full_name} · {fmtDate(r.created_at)}{r.initiated_by === 'mentor' ? ' · offer' : ''}</p></div>
              <Badge tone={REQ_TONE[r.status]} className="capitalize">{r.status}</Badge>
            </Link></li>
          );
        })}</ul>
      )}
    </Card>
  );
}

function BecomeMentor({ mentor }: { mentor: MentorT | null }) {
  const [f, setF] = useState({
    industry: mentor?.industry ?? '', expertise: mentor?.expertise.join(', ') ?? '', skills: mentor?.skills.join(', ') ?? '', experience_years: mentor?.experience_years ? String(mentor.experience_years) : '',
    hours_per_month: String(mentor?.hours_per_month ?? 2), formats: mentor?.formats ?? ['video'], mentees_students: mentor?.mentees_students ?? true,
    mentees_alumni: mentor?.mentees_alumni ?? true, max_mentees: String(mentor?.max_mentees ?? 3), introduction: mentor?.introduction ?? '', categories: mentor?.categories ?? [],
  });
  const defs = useCustomFields('mentor');
  const [extra, setExtra] = useState<CustomValues>(mentor?.custom_fields ?? {});
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = useAction(() => api('/api/v1/mentorship/me', { method: 'PUT', body: { ...f, custom_fields: extra, expertise: list(f.expertise), skills: list(f.skills),
    experience_years: f.experience_years ? Number(f.experience_years) : null, hours_per_month: Number(f.hours_per_month), max_mentees: Number(f.max_mentees) } }),
  { success: mentor ? 'Mentor profile saved.' : 'Application sent — the mentorship coordinator will review it.', invalidate: [['mentorship-me']] });
  const pause = useAction((paused: boolean) => api('/api/v1/mentorship/me/availability', { method: 'POST', body: { paused } }), { success: 'Saved.', invalidate: [['mentorship-me']] });
  const e = save.fieldErrors;
  return (
    <Card>
      <CardHeader title={mentor ? 'My mentor profile' : 'Become a mentor'} icon={GraduationCap}
        description={mentor ? undefined : 'Share your experience with SST students and fellow alumni. Applications are reviewed by the mentorship coordinator.'}
        action={mentor && ['approved', 'paused'].includes(mentor.status) && <Button size="sm" variant="outline" onClick={() => pause.mutate(mentor.status === 'approved')}>{mentor.status === 'approved' ? 'Pause new requests' : 'Resume'}</Button>} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {mentor && <Alert tone={mentor.status === 'approved' ? 'success' : mentor.status === 'rejected' ? 'danger' : 'info'} className="sm:col-span-2"
          title={{ pending: 'Application under review', approved: 'You are a mentor', rejected: 'Application not approved', paused: 'Paused — not accepting new requests' }[mentor.status]}>
          {mentor.rejection_reason ?? (mentor.status === 'approved' ? `${mentor.active_mentees} of ${mentor.max_mentees} places taken.` : undefined)}</Alert>}
        <Field label="Industry" required error={e.industry}>{(id) => <Select id={id} value={f.industry} onChange={(x) => setF({ ...f, industry: x.target.value })}><option value="">Select…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
        <Field label="Years of experience" error={e.experience_years}>{(id) => <Input id={id} type="number" min={0} value={f.experience_years} onChange={(x) => setF({ ...f, experience_years: x.target.value })} />}</Field>
        <Field label="Areas of expertise" required hint="Comma-separated, e.g. Career planning, Interview preparation" error={e.expertise} className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} value={f.expertise} onChange={(x) => setF({ ...f, expertise: x.target.value })} />}</Field>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[13px] font-medium text-ink">Mentorship categories</legend>
          <div className="flex flex-wrap gap-2">{MENTOR_CATS.map((c) => <button key={c.k} type="button" aria-pressed={f.categories.includes(c.k)} onClick={() => setF({ ...f, categories: f.categories.includes(c.k) ? f.categories.filter((x) => x !== c.k) : [...f.categories, c.k] })}
            className={cn('rounded-full border px-3 py-1 text-sm', f.categories.includes(c.k) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink')}>{c.l}</button>)}</div></fieldset>
        <Field label="Skills" hint="Comma-separated" className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} value={f.skills} onChange={(x) => setF({ ...f, skills: x.target.value })} />}</Field>
        <Field label="Hours per month">{(id) => <Input id={id} type="number" min={1} max={80} value={f.hours_per_month} onChange={(x) => setF({ ...f, hours_per_month: x.target.value })} />}</Field>
        <Field label="Maximum mentees at a time">{(id) => <Input id={id} type="number" min={1} max={30} value={f.max_mentees} onChange={(x) => setF({ ...f, max_mentees: x.target.value })} />}</Field>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[13px] font-medium text-ink">Preferred formats</legend>
          <div className="flex flex-wrap gap-4">{Object.entries(FORMAT).map(([k, l]) => <Checkbox key={k} checked={f.formats.includes(k)} label={l}
            onCheckedChange={(v) => setF({ ...f, formats: v ? [...f.formats, k] : f.formats.filter((x) => x !== k) })} />)}</div></fieldset>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[13px] font-medium text-ink">I would like to mentor</legend>
          <div className="flex gap-4"><Checkbox checked={f.mentees_students} onCheckedChange={(v) => setF({ ...f, mentees_students: v })} label="Current students" />
            <Checkbox checked={f.mentees_alumni} onCheckedChange={(v) => setF({ ...f, mentees_alumni: v })} label="Alumni" /></div></fieldset>
        <Field label="Short introduction" required hint="At least 30 characters — who you are and how you can help." error={e.introduction} className="sm:col-span-2">
          {(id, d) => <Textarea id={id} aria-describedby={d} value={f.introduction} maxLength={3000} onChange={(x) => setF({ ...f, introduction: x.target.value })} className="min-h-[120px]" />}</Field>
        {!!defs.data?.length && <div className="border-t border-line pt-4 sm:col-span-2"><CustomFieldsForm defs={defs.data} value={extra} onChange={setExtra} errors={customErrors(e)} /></div>}
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3"><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{mentor ? 'Save' : 'Apply to become a mentor'}</Button></div>
    </Card>
  );
}

export function MentorshipRequestPage() {
  const { id } = useParams();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['mentorship', id], queryFn: () => get<Req>(`/api/v1/mentorship/requests/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const inv = [['mentorship', id], ['mentorships'], ['mentorship-me']];
  const [note, setNote] = useState('');
  const respond = useAction((accept: boolean) => api(`/api/v1/mentorship/requests/${id}/respond`, { method: 'POST', body: { accept, note: note || null } }), { success: 'Reply sent.', invalidate: inv });
  const act = useAction((a: 'cancel' | 'complete') => api(`/api/v1/mentorship/requests/${id}/${a}`, { method: 'POST' }), { success: 'Done.', invalidate: inv });
  const [scheduling, setScheduling] = useState(false);
  const r = q.data;
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!r) return <Card><EmptyState icon={UsersRound} title="Mentorship not found" /></Card>;
  const other = r.role === 'mentor' ? r.mentee : r.mentor;
  const hadSession = r.sessions?.some((s) => s.status === 'completed');
  return (
    <>
      <Link to="/portal/mentorship/tab/mine" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />My mentorships</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={REQ_TONE[r.status]} className="capitalize">{r.status}</Badge><span className="text-xs text-ink-muted">{r.initiated_by === 'mentor' ? 'Offered' : 'Requested'} {fmtDate(r.created_at)}</span></div>
            <h1 className="mt-2 font-heading text-xl font-semibold text-ink">{r.topic}</h1>
            <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.goals}</p>
            {r.preferred_format && <p className="mt-2 text-xs text-ink-muted">Preferred: {FORMAT[r.preferred_format]}</p>}
            {r.response_note && <Alert tone="info" className="mt-4" title="Reply note">{r.response_note}</Alert>}
            {r.awaiting_me && (
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                <Textarea aria-label="Note" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                <div className="flex gap-2"><Button loading={respond.isPending} onClick={() => respond.mutate(true)}><Check />Accept</Button><Button variant="outline" onClick={() => respond.mutate(false)}><X />Decline</Button></div>
              </div>
            )}
          </Card>
          {['accepted', 'completed'].includes(r.status) && (
            <Card>
              <CardHeader title="Sessions" icon={CalendarClock} action={r.status === 'accepted' && <Button size="sm" onClick={() => setScheduling(true)}>Schedule session</Button>} />
              {!r.sessions?.length ? <p className="p-5 text-sm text-ink-muted">No sessions yet — schedule the first one.</p> : (
                <ul className="divide-y divide-line">{r.sessions.map((s) => <SessionRow key={s.id} s={s} isMentor={r.role === 'mentor'} reqId={r.id} />)}</ul>
              )}
            </Card>
          )}
          {(r.status === 'completed' || hadSession) && <FeedbackCard r={r} />}
        </div>
        <aside className="space-y-4">
          <Card className="p-5 text-center">
            <Avatar name={other?.full_name} src={photoUrl(other?.photo ?? null, 160)} size={72} className="mx-auto" />
            <p className="mt-2 font-medium text-ink">{other?.full_name}</p><p className="text-xs text-ink-muted">{r.role === 'mentor' ? 'Your mentee' : 'Your mentor'}{other?.batch ? ` · ${other.batch}` : ''}</p>
            {other && <Button asChild variant="outline" size="sm" className="mt-3"><Link to={`/portal/alumni/${other.id}`}>View profile</Link></Button>}
          </Card>
          {r.status === 'accepted' && <Button variant="outline" className="w-full" onClick={async () => { if (await confirm({ title: 'Mark this mentorship as completed?', confirmLabel: 'Complete' })) act.mutate('complete'); }}><Check />Mark as completed</Button>}
          {['pending', 'accepted'].includes(r.status) && r.role === 'mentee' && <Button variant="ghost" className="w-full" onClick={async () => { if (await confirm({ title: 'Cancel this mentorship?', confirmLabel: 'Cancel mentorship', danger: true })) act.mutate('cancel'); }}>Cancel</Button>}
        </aside>
      </div>
      {scheduling && <SessionDialog reqId={r.id} onClose={() => setScheduling(false)} />}
    </>
  );
}

function SessionRow({ s, isMentor, reqId }: { s: NonNullable<Req['sessions']>[number]; isMentor: boolean; reqId: string }) {
  const [outcome, setOutcome] = useState(s.outcome ?? '');
  const [editing, setEditing] = useState(false);
  const save = useAction((body: Record<string, unknown>) => api(`/api/v1/mentorship/sessions/${s.id}`, { method: 'PATCH', body }), { success: 'Saved.', invalidate: [['mentorship', reqId]], onSuccess: () => setEditing(false) });
  return (
    <li className="px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{fmtDateTime(s.scheduled_at)} · {s.duration_minutes} min · {FORMAT[s.format]}</p>
        <Badge tone={s.status === 'completed' ? 'success' : s.status === 'cancelled' ? 'neutral' : 'primary'} className="capitalize">{s.status}</Badge>
      </div>
      {s.location && <p className="mt-1 break-all text-ink-muted">{/^https?:\/\//.test(s.location) ? <a href={s.location} target="_blank" rel="noopener noreferrer" className="text-primary underline">{s.location}</a> : s.location}</p>}
      {s.agenda && <p className="mt-1 text-ink">Agenda: {s.agenda}</p>}
      {s.outcome && !editing && <p className="mt-2 rounded-btn bg-canvas p-2 text-ink"><MessageSquareQuote className="mr-1 inline h-4 w-4 text-ink-muted" />{s.outcome}</p>}
      {isMentor && s.status !== 'cancelled' && (editing ? (
        <div className="mt-2 space-y-2"><Textarea aria-label="Session outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={5000} placeholder="What was discussed, next steps…" />
          <div className="flex gap-2"><Button size="sm" loading={save.isPending} onClick={() => save.mutate({ outcome })}>Save outcome</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div></div>
      ) : <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(true)}>{s.outcome ? 'Edit outcome' : 'Record outcome'}</Button>
        {s.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => save.mutate({ status: 'cancelled' })}>Cancel session</Button>}</div>)}
    </li>
  );
}

function SessionDialog({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const [f, setF] = useState({ when: '', duration_minutes: '45', format: 'video', location: '', agenda: '' });
  const save = useAction(() => api(`/api/v1/mentorship/requests/${reqId}/sessions`, { method: 'POST', body: {
    scheduled_at: new Date(f.when).toISOString(), duration_minutes: Number(f.duration_minutes), format: f.format, location: f.location || null, agenda: f.agenda || null } }),
  { success: 'Session scheduled — both of you were emailed.', invalidate: [['mentorship', reqId]], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Schedule a session"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.when} onClick={() => save.mutate(undefined)}>Schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date and time" required className="sm:col-span-2">{(id) => <Input id={id} type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />}</Field>
        <Field label="Duration (minutes)">{(id) => <Input id={id} type="number" min={10} max={480} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} />}</Field>
        <Field label="Format">{(id) => <Select id={id} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>{Object.entries(FORMAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <Field label="Meeting link or place" className="sm:col-span-2">{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
        <Field label="Agenda" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.agenda} maxLength={2000} onChange={(e) => setF({ ...f, agenda: e.target.value })} className="min-h-[70px]" />}</Field>
      </div>
    </Dialog>
  );
}

function FeedbackCard({ r }: { r: Req }) {
  const mine = r.feedback?.mine;
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const save = useAction(() => api(`/api/v1/mentorship/requests/${r.id}/feedback`, { method: 'PUT', body: { rating, comment: comment || null } }), { success: 'Thank you for your feedback.', invalidate: [['mentorship', r.id]] });
  return (
    <Card>
      <CardHeader title="Feedback" icon={Star} description={r.feedback?.theirs ? `${r.role === 'mentor' ? 'Your mentee' : 'Your mentor'} rated ${r.feedback.theirs.rating}/5` : undefined} />
      <div className="space-y-3 p-5">
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} stars`} onClick={() => setRating(n)}><Star className={cn('h-7 w-7', n <= rating ? 'fill-warning text-warning' : 'text-line')} /></button>))}</div>
        <Textarea aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder={r.role === 'mentee' ? 'Shown on the mentor\'s profile as a testimonial.' : 'Private feedback.'} />
        <Button disabled={!rating} loading={save.isPending} onClick={() => save.mutate(undefined)}>{mine ? 'Update' : 'Send feedback'}</Button>
      </div>
    </Card>
  );
}

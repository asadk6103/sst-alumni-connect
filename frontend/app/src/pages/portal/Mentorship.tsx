import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Check, GraduationCap, MessageSquareQuote, Search, Star, Users, UsersRound, X } from 'lucide-react';
import { api, ApiError, get, qs, type Paged } from '@/lib/api';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { INDUSTRIES } from '@/lib/countries';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import type { Author } from '@/components/community';

export type MentorT = {
  user: Author; status: string; industry: string | null; expertise: string[]; skills: string[]; experience_years: number | null; hours_per_month: number;
  formats: string[]; mentees_students: boolean; mentees_alumni: boolean; max_mentees: number; introduction: string; rating: number | null; reviews: number;
  active_mentees: number; available: boolean; rejection_reason?: string | null;
  testimonials?: { rating: number; comment: string; from: Author | null; created_at: string }[]; my_request?: { id: string; status: string } | null;
};
type Req = {
  id: string; mentor: Author | null; mentee: Author | null; topic: string; goals: string; preferred_format: string | null; status: string; response_note: string | null;
  created_at: string; responded_at: string | null; completed_at: string | null; role: 'mentor' | 'mentee';
  sessions?: { id: string; scheduled_at: string; duration_minutes: number; format: string; location: string | null; agenda: string | null; status: string; outcome: string | null }[];
  feedback?: { mine: { rating: number; comment: string | null } | null; theirs: { rating: number; comment: string | null } | null };
};
const FORMAT: Record<string, string> = { video: 'Video call', phone: 'Phone', in_person: 'In person', chat: 'Chat' };
const REQ_TONE: Record<string, 'warning' | 'success' | 'neutral' | 'primary' | 'danger'> = { pending: 'warning', accepted: 'success', declined: 'danger', cancelled: 'neutral', completed: 'primary' };

export function Stars({ value, size = 'h-4 w-4' }: { value: number | null; size?: string }) {
  return <span className="inline-flex" aria-label={value ? `${value} out of 5` : 'No ratings yet'}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn(size, value && n <= Math.round(value) ? 'fill-warning text-warning' : 'text-line')} />)}</span>;
}

export function MentorCard({ m, onOpen }: { m: MentorT; onOpen: () => void }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-3">
        <Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 96)} size={52} />
        <div className="min-w-0"><button onClick={onOpen} className="truncate text-left font-heading font-semibold text-ink hover:text-primary">{m.user.full_name}</button>
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

export function MentorshipPage() {
  const { tab = 'find' } = useParams();
  const nav = useNavigate();
  const me = useQuery({ queryKey: ['mentorship-me'], queryFn: () => get<{ mentor: MentorT | null; counts: Record<string, number>; can_apply: boolean; can_request: boolean }>('/api/v1/mentorship/me') });
  return (
    <>
      <PageHeader title="Mentorship" description="Guidance from experienced SST alumni — for students and alumni alike." />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'find' ? '/portal/mentorship' : `/portal/mentorship/tab/${v}`)}
        tabs={[{ value: 'find', label: 'Find a mentor' }, { value: 'mine', label: 'My mentorships' }, ...(me.data?.can_apply ? [{ value: 'become', label: me.data.mentor ? 'My mentor profile' : 'Become a mentor' }] : [])]}><span /></Tabs>
      <div className="mt-5">{tab === 'mine' ? <MyMentorships /> : tab === 'become' ? <BecomeMentor mentor={me.data?.mentor ?? null} /> : <FindMentor canRequest={!!me.data?.can_request} />}</div>
    </>
  );
}

function FindMentor({ canRequest }: { canRequest: boolean }) {
  const [q, setQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [format, setFormat] = useState('');
  const [available, setAvailable] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, industry, format, available: available || undefined, page, page_size: 12 };
  const list = useQuery({ queryKey: ['mentors', params], queryFn: () => api<Paged<MentorT> & { meta: { industries: string[] } }>(`/api/v1/mentorship/mentors${qs(params)}`), placeholderData: keepPreviousData });
  return (
    <>
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col items-center gap-2 bg-primary-soft/60 px-6 py-8 text-center">
          <UsersRound className="h-10 w-10 text-primary" />
          <p className="font-heading text-xl font-semibold text-ink">Find a mentor</p>
          <p className="max-w-md text-sm text-ink-muted">Get guidance from experienced SST alumni on careers, studies and life after school.</p>
        </div>
        <div className="grid gap-3 border-t border-line p-4 md:grid-cols-[1fr_auto_auto]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search mentors" placeholder="Search by name, expertise or skill…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
          <Select aria-label="Industry" value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }} className="md:w-52">
            <option value="">Any industry</option>{(list.data?.meta.industries.length ? list.data.meta.industries : INDUSTRIES).map((i) => <option key={i}>{i}</option>)}</Select>
          <Select aria-label="Format" value={format} onChange={(e) => { setFormat(e.target.value); setPage(1); }} className="md:w-40">
            <option value="">Any format</option>{Object.entries(FORMAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <div className="md:col-span-3"><Checkbox checked={available} onCheckedChange={(v) => { setAvailable(v); setPage(1); }} label="Only mentors with free places" /></div>
        </div>
      </Card>
      {list.isLoading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-card" />)}</div>
        : !list.data?.data.length ? <Card><EmptyState icon={Users} title="No mentors found" description="Try a different search — new mentors join regularly." /></Card>
        : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.data.data.map((m) => <MentorCard key={m.user.id} m={m} onOpen={() => setOpen(m.user.id)} />)}</div>}
      {list.data && list.data.meta.pages > 1 && <Card className="mt-5"><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
      {open && <MentorDialog id={open} canRequest={canRequest} onClose={() => setOpen(null)} />}
    </>
  );
}

export function MentorDialog({ id, canRequest, onClose }: { id: string; canRequest: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['mentor', id], queryFn: () => get<MentorT>(`/api/v1/mentorship/mentors/${id}`) });
  const [asking, setAsking] = useState(false);
  const [f, setF] = useState({ topic: '', goals: '', preferred_format: '' });
  const send = useAction(() => api<{ data: Req }>('/api/v1/mentorship/requests', { method: 'POST', body: { mentor_id: id, ...f, preferred_format: f.preferred_format || null } }),
    { success: 'Request sent. You will be emailed when the mentor replies.', invalidate: [['mentor', id], ['mentorships']], onSuccess: (r) => { onClose(); nav(`/portal/mentorship/requests/${r.data.id}`); } });
  const m = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={m?.user.full_name ?? 'Mentor'}
      footer={m && (m.my_request ? <Button asChild><Link to={`/portal/mentorship/requests/${m.my_request.id}`}>Open my request ({m.my_request.status})</Link></Button>
        : asking ? <><Button variant="outline" onClick={() => setAsking(false)}>Back</Button><Button loading={send.isPending} disabled={f.topic.length < 3 || f.goals.length < 20} onClick={() => send.mutate(undefined)}>Send request</Button></>
        : canRequest && m.available ? <Button onClick={() => setAsking(true)}>Request mentorship</Button>
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
          <div><p className="mb-1 text-xs font-medium uppercase text-ink-muted">Areas of expertise</p><div className="flex flex-wrap gap-1">{m.expertise.map((x) => <Badge key={x} tone="primary">{x}</Badge>)}</div></div>
          <p className="text-sm text-ink-muted">{m.formats.map((x) => FORMAT[x]).join(' · ')} · about {m.hours_per_month} h/month · mentors {[m.mentees_students && 'students', m.mentees_alumni && 'alumni'].filter(Boolean).join(' and ')}</p>
          {!!m.testimonials?.length && <div className="space-y-2">{m.testimonials.map((t, i) => (
            <blockquote key={i} className="rounded-card bg-canvas p-3 text-sm"><Stars value={t.rating} size="h-3.5 w-3.5" /><p className="mt-1 text-ink">“{t.comment}”</p><p className="mt-1 text-xs text-ink-muted">— {t.from?.full_name}</p></blockquote>))}</div>}
        </div>
      )}
    </Dialog>
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
                <p className="truncate text-xs text-ink-muted">{r.role === 'mentor' ? 'Mentee' : 'Mentor'}: {other?.full_name} · {fmtDate(r.created_at)}</p></div>
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
    mentees_alumni: mentor?.mentees_alumni ?? true, max_mentees: String(mentor?.max_mentees ?? 3), introduction: mentor?.introduction ?? '',
  });
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = useAction(() => api('/api/v1/mentorship/me', { method: 'PUT', body: { ...f, expertise: list(f.expertise), skills: list(f.skills),
    experience_years: f.experience_years ? Number(f.experience_years) : null, hours_per_month: Number(f.hours_per_month), max_mentees: Number(f.max_mentees) } }),
  { success: mentor ? 'Mentor profile saved.' : 'Application sent — the mentorship coordinator will review it.', invalidate: [['mentorship-me']] });
  const pause = useAction((paused: boolean) => api('/api/v1/mentorship/me/availability', { method: 'POST', body: { paused } }), { success: 'Saved.', invalidate: [['mentorship-me']] });
  const e = save.fieldErrors;
  return (
    <Card className="max-w-3xl">
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
            <div className="flex flex-wrap items-center gap-2"><Badge tone={REQ_TONE[r.status]} className="capitalize">{r.status}</Badge><span className="text-xs text-ink-muted">Requested {fmtDate(r.created_at)}</span></div>
            <h1 className="mt-2 font-heading text-xl font-semibold text-ink">{r.topic}</h1>
            <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.goals}</p>
            {r.preferred_format && <p className="mt-2 text-xs text-ink-muted">Preferred: {FORMAT[r.preferred_format]}</p>}
            {r.response_note && <Alert tone="info" className="mt-4" title="Mentor's note">{r.response_note}</Alert>}
            {r.status === 'pending' && r.role === 'mentor' && (
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                <Textarea aria-label="Note to the mentee" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
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

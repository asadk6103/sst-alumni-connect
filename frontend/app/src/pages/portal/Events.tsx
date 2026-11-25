import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, CalendarDays, CalendarPlus, Clock, MapPin, Search, Star, Ticket, Users, Video, X } from 'lucide-react';
import { api, ApiError, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { useRoom } from '@/lib/live';
import { cn, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { ExtraFields, type ExtraField } from '@/components/customFields';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { RichText } from '@/components/community';

export type Img = { id: string; url: string; variants: { width: number; url: string }[]; alt: string } | null;
export type EventT = {
  id: string; title: string; kind: string; kind_label: string; summary: string; banner: Img; starts_at: string; ends_at: string; venue: string | null;
  address: string | null; is_online: boolean; capacity: number | null; seats_left: number | null; registered_count: number; max_guests: number;
  registration_deadline: string | null; registration_open: boolean; status: string; cancel_reason: string | null; batch: string | null; batch_id: string | null;
  is_past: boolean; my_registration: { id: string; status: string; guests: number; checkin_code: string | null } | null;
  description?: string; online_url?: string | null; gallery?: Img[]; custom_fields?: Record<string, unknown> | null; extra_fields?: ExtraField[];
  feedback?: { average: number | null; count: number; mine: { rating: number; comment: string | null } | null };
};

export const pick = (img: Img, w: number) => (img ? img.variants.find((v) => v.width >= w)?.url ?? img.url : undefined);
export const when = (e: Pick<EventT, 'starts_at' | 'ends_at'>) => {
  const s = new Date(e.starts_at);
  const sameDay = s.toDateString() === new Date(e.ends_at).toDateString();
  return `${s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${sameDay ? `–${new Date(e.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`;
};
const STATUS: Record<string, { tone: 'success' | 'warning' | 'neutral' | 'primary'; label: string }> = {
  registered: { tone: 'success', label: 'Registered' }, waitlisted: { tone: 'warning', label: 'Waitlisted' }, attended: { tone: 'primary', label: 'Attended' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};
const KINDS: [string, string][] = [['', 'All events'], ['reunion', 'Reunions'], ['batch_reunion', 'Batch reunions'], ['webinar', 'Webinars'],
  ['seminar', 'Seminars'], ['networking', 'Networking'], ['sports', 'Sports'], ['career', 'Career guidance']];

export function EventCard({ e }: { e: EventT }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={`/portal/events/${e.id}`} className="relative block aspect-[16/7] bg-gradient-to-br from-navy to-primary">
        {e.banner && <img src={pick(e.banner, 800)} alt="" loading="lazy" className="h-full w-full object-cover" />}
        <span className="absolute left-3 top-3"><Badge tone="navy">{e.kind_label}</Badge></span>
        {e.status === 'cancelled' && <span className="absolute inset-0 grid place-items-center bg-navy-dark/70 font-heading text-lg font-semibold text-white">Cancelled</span>}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link to={`/portal/events/${e.id}`} className="font-heading text-[17px] font-semibold leading-snug text-ink hover:text-primary">{e.title}</Link>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink"><CalendarDays className="h-4 w-4 text-ink-muted" />{when(e)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">{e.is_online ? <><Video className="h-4 w-4" />Online</> : <><MapPin className="h-4 w-4" />{e.venue}</>}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          {e.my_registration && e.my_registration.status !== 'cancelled' ? <Badge tone={STATUS[e.my_registration.status]!.tone}>{STATUS[e.my_registration.status]!.label}</Badge>
            : <span className="text-xs text-ink-muted">{e.seats_left === null ? 'Open registration' : e.seats_left > 0 ? `${e.seats_left} seats left` : 'Full — waitlist'}</span>}
          <Button asChild size="sm" variant={e.my_registration?.status === 'registered' ? 'outline' : 'primary'}>
            <Link to={`/portal/events/${e.id}`}>{e.my_registration?.status === 'registered' ? 'View ticket' : e.registration_open ? 'Register now' : 'Details'}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function EventsPage() {
  const [scope, setScope] = useState('upcoming');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const params = { scope, kind, q: dq, page, page_size: 12 };
  const list = useQuery({ queryKey: ['events', params], queryFn: () => api<Paged<EventT>>(`/api/v1/events${qs(params)}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Events & Reunions" description="Reunions, webinars, career sessions and sports — register and get your ticket here." />
      <Card className="mb-5 flex flex-col gap-3 p-2 lg:flex-row lg:items-center">
        <div className="flex-1 px-2"><Tabs value={scope} onValueChange={(v) => { setScope(v); setPage(1); }}
          tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'mine', label: 'My events' }, { value: 'past', label: 'Past' }]}><span /></Tabs></div>
        <div className="flex gap-2 px-2 pb-2 lg:pb-0">
          <Select aria-label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="h-9 w-44">
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <div className="relative w-full lg:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search events" placeholder="Search events…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-9 pl-9" /></div>
        </div>
      </Card>
      {list.isLoading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-card" />)}</div>
        : !list.data?.data.length ? <Card><EmptyState icon={CalendarDays} title={scope === 'mine' ? 'You have no events yet' : 'No events found'} description={scope === 'upcoming' ? 'New events are announced here and by email.' : undefined} /></Card>
        : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.data.data.map((e) => <EventCard key={e.id} e={e} />)}</div>}
      {list.data && list.data.meta.pages > 1 && <Card className="mt-5"><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
    </>
  );
}

export function EventPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [registering, setRegistering] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['event', id], queryFn: () => get<EventT>(`/api/v1/events/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const cancel = useAction(() => api(`/api/v1/events/${id}/cancel`, { method: 'POST' }), { success: 'Registration cancelled.', invalidate: [['event', id], ['events']] });
  useRoom(q.data?.my_registration && q.data.my_registration.status !== 'cancelled' ? `event:${id}` : null, {
    'event:seats': () => q.refetch(), 'event:updated': () => q.refetch(),
  });
  const e = q.data;
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!e) return <Card><EmptyState icon={CalendarDays} title="Event not found" action={<Button asChild variant="outline"><Link to="/portal/events">All events</Link></Button>} /></Card>;
  const reg = e.my_registration && e.my_registration.status !== 'cancelled' ? e.my_registration : null;
  const started = new Date(e.starts_at) <= new Date();
  return (
    <>
      <Link to="/portal/events" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Events</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <div className="aspect-[16/6] bg-gradient-to-br from-navy to-primary">{e.banner && <img src={pick(e.banner, 1200)} alt="" className="h-full w-full object-cover" />}</div>
            <div className="p-5">
              <div className="flex flex-wrap gap-2"><Badge tone="navy">{e.kind_label}</Badge>{e.batch && <Badge tone="primary">{e.batch} only</Badge>}</div>
              <h1 className="mt-3 font-heading text-2xl font-semibold text-ink">{e.title}</h1>
              {e.summary && <p className="mt-1 text-ink-muted">{e.summary}</p>}
              {e.status === 'cancelled' && <Alert tone="danger" className="mt-4" title="This event was cancelled">{e.cancel_reason}</Alert>}
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex gap-2"><CalendarDays className="h-5 w-5 shrink-0 text-primary" /><div><dt className="font-medium text-ink">When</dt><dd className="text-ink-muted">{when(e)}</dd></div></div>
                <div className="flex gap-2">{e.is_online ? <Video className="h-5 w-5 shrink-0 text-primary" /> : <MapPin className="h-5 w-5 shrink-0 text-primary" />}
                  <div><dt className="font-medium text-ink">Where</dt><dd className="text-ink-muted">{e.is_online ? 'Online' : [e.venue, e.address].filter(Boolean).join(', ')}</dd></div></div>
                {e.registration_deadline && <div className="flex gap-2"><Clock className="h-5 w-5 shrink-0 text-primary" /><div><dt className="font-medium text-ink">Register by</dt><dd className="text-ink-muted">{fmtDateTime(e.registration_deadline)}</dd></div></div>}
                <div className="flex gap-2"><Users className="h-5 w-5 shrink-0 text-primary" /><div><dt className="font-medium text-ink">Places</dt><dd className="text-ink-muted">{e.capacity === null ? 'Unlimited' : `${e.seats_left} of ${e.capacity} left`}</dd></div></div>
              </dl>
            </div>
          </Card>
          {e.description && <Card><CardHeader title="About this event" /><div className="p-5"><RichText text={e.description} /></div></Card>}
          {!!e.extra_fields?.length && <Card><CardHeader title="More details" /><ExtraFields className="p-5" items={e.extra_fields} fileHref={(k) => `/api/v1/custom-fields/event/${e.id}/${k}/file`} /></Card>}
          {!!e.gallery?.length && (
            <Card><CardHeader title="Photos" />
              <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">{e.gallery.map((g, i) => g && (
                <button key={g.id} onClick={() => setPhoto(i)} className="overflow-hidden rounded-btn"><img src={pick(g, 480)} alt={g.alt} loading="lazy" className="aspect-[4/3] w-full object-cover transition hover:scale-105" /></button>
              ))}</div>
            </Card>
          )}
          {reg && started && <Feedback e={e} />}
        </div>
        <aside className="space-y-5">
          <Card className="p-5">
            {reg ? (
              <div className="text-center">
                <Badge tone={STATUS[reg.status]!.tone}>{STATUS[reg.status]!.label}{reg.guests ? ` · +${reg.guests} guest${reg.guests > 1 ? 's' : ''}` : ''}</Badge>
                {reg.status === 'waitlisted' ? <p className="mt-3 text-sm text-ink-muted">You will be registered automatically — and emailed — if a place frees up.</p> : reg.checkin_code && (
                  <>
                    <div className="mx-auto mt-4 w-fit rounded-card border border-line bg-white p-3"><QRCodeSVG value={`sst-ticket:${reg.checkin_code}`} size={180} level="M" /></div>
                    <p className="mt-2 flex items-center justify-center gap-1 text-xs text-ink-muted"><Ticket className="h-3.5 w-3.5" />Show this code at the entrance</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">{reg.checkin_code.slice(0, 8).toUpperCase()}</p>
                  </>
                )}
                {e.online_url && <Button asChild className="mt-4 w-full"><a href={e.online_url} target="_blank" rel="noopener noreferrer"><Video />Join online</a></Button>}
                <div className="mt-4 grid gap-2">
                  <Button variant="outline" onClick={() => download(`/api/v1/events/${e.id}/calendar.ics`, `${e.title}.ics`)}><CalendarPlus />Add to calendar</Button>
                  {!started && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Cancel your registration?', description: 'Your place goes to the next person on the waitlist.', confirmLabel: 'Cancel registration', danger: true })) cancel.mutate(undefined); }}><X />Cancel registration</Button>}
                </div>
              </div>
            ) : e.registration_open ? (
              <>
                <p className="font-heading text-lg font-semibold text-ink">{e.seats_left === 0 ? 'This event is full' : 'Join us'}</p>
                <p className="mt-1 text-sm text-ink-muted">{e.seats_left === 0 ? 'Join the waitlist — we will email you if a place frees up.' : 'Register to receive your ticket and reminders.'}</p>
                {can('portal.events.register') ? <Button className="mt-4 w-full" onClick={() => setRegistering(true)}>{e.seats_left === 0 ? 'Join waitlist' : 'Register now'}</Button>
                  : <Alert tone="info" className="mt-4">Registration is open to verified members.</Alert>}
              </>
            ) : <p className="text-sm text-ink-muted">{e.is_past ? 'This event has ended.' : e.status === 'cancelled' ? 'This event was cancelled.' : 'Registration is closed.'}</p>}
          </Card>
        </aside>
      </div>
      {registering && <RegisterDialog e={e} onClose={() => setRegistering(false)} />}
      {photo !== null && e.gallery && (
        <Dialog open onOpenChange={(v) => !v && setPhoto(null)} title={`Photo ${photo + 1} of ${e.gallery.length}`} wide
          footer={<><Button variant="outline" onClick={() => setPhoto((photo + e.gallery!.length - 1) % e.gallery!.length)}>Previous</Button><Button variant="outline" onClick={() => setPhoto((photo + 1) % e.gallery!.length)}>Next</Button></>}>
          <img src={pick(e.gallery[photo] ?? null, 1920)} alt="" className="mx-auto max-h-[70vh]" />
        </Dialog>
      )}
    </>
  );
}

function RegisterDialog({ e, onClose }: { e: EventT; onClose: () => void }) {
  const [guests, setGuests] = useState('0');
  const [note, setNote] = useState('');
  const reg = useAction(() => api<{ data: EventT }>(`/api/v1/events/${e.id}/register`, { method: 'POST', body: { guests: Number(guests), note: note || null } }),
    { success: (r) => (r.data.my_registration?.status === 'waitlisted' ? 'You are on the waitlist.' : 'You are registered — your ticket is ready.'),
      invalidate: [['event', e.id], ['events'], ['alumni-dashboard']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Register for ${e.title}`} description={when(e)}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={reg.isPending} onClick={() => reg.mutate(undefined)}>{e.seats_left === 0 ? 'Join waitlist' : 'Confirm registration'}</Button></>}>
      <div className="space-y-4">
        {e.max_guests > 0 && <Field label="Guests" hint={`You can bring up to ${e.max_guests}.`} error={reg.fieldErrors.guests}>{(id, d) => (
          <Select id={id} aria-describedby={d} value={guests} onChange={(x) => setGuests(x.target.value)}>{Array.from({ length: e.max_guests + 1 }).map((_, i) => <option key={i} value={i}>{i === 0 ? 'Just me' : `+${i}`}</option>)}</Select>)}</Field>}
        <Field label="Note for the organisers (optional)" hint="Dietary needs, accessibility…">{(id, d) => <Textarea id={id} aria-describedby={d} value={note} onChange={(x) => setNote(x.target.value)} maxLength={300} className="min-h-[70px]" />}</Field>
      </div>
    </Dialog>
  );
}

function Feedback({ e }: { e: EventT }) {
  const mine = e.feedback?.mine;
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const save = useAction(() => api(`/api/v1/events/${e.id}/feedback`, { method: 'PUT', body: { rating, comment: comment || null } }), { success: 'Thank you for your feedback!', invalidate: [['event', e.id]] });
  return (
    <Card>
      <CardHeader title="How was it?" icon={Star} description={e.feedback?.count ? `${e.feedback.average} ★ from ${e.feedback.count} attendee(s)` : 'Your feedback helps us plan better events.'} />
      <div className="space-y-3 p-5">
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}>
            <Star className={cn('h-7 w-7', n <= rating ? 'fill-warning text-warning' : 'text-line')} /></button>
        ))}</div>
        <Textarea aria-label="Comment" placeholder="What did you enjoy? What could be better?" value={comment} onChange={(x) => setComment(x.target.value)} maxLength={2000} />
        <Button disabled={!rating} loading={save.isPending} onClick={() => save.mutate(undefined)}>{mine ? 'Update feedback' : 'Send feedback'}</Button>
      </div>
    </Card>
  );
}


import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight, Bookmark, BookmarkCheck, CalendarDays, CalendarPlus, Camera, Check, ChevronLeft, ChevronRight, Clock, Copy, Download, FileText, Files, Gift,
  Image as ImageIcon, Info, MapPin, MessageCircle, MoreHorizontal, Music, Navigation, Plus, Search, Share2, Sparkles, Star, Ticket, Trash2, UserPlus, Users,
  UsersRound, Utensils, Video, X,
} from 'lucide-react';
import { api, ApiError, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { useRoom } from '@/lib/live';
import { photoUrl } from '@/lib/alumni';
import { cn, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { ExtraFields, type ExtraField } from '@/components/customFields';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { VerifiedBadge } from '@/components/alumni';
import { RichText, SectionCard, fileSize, type Author } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

export type Img = { id: string; url: string; variants: { width: number; url: string }[]; alt: string } | null;
export type Agenda = { time: string; title: string };
export type EventT = {
  id: string; title: string; kind: string; kind_label: string; summary: string; banner: Img; starts_at: string; ends_at: string; venue: string | null;
  address: string | null; is_online: boolean; capacity: number | null; seats_left: number | null; registered_count: number; max_guests: number;
  registration_deadline: string | null; registration_open: boolean; status: string; cancel_reason: string | null; batch: string | null; batch_id: string | null;
  is_past: boolean; my_registration: { id: string; status: string; guests: number; checkin_code: string | null } | null;
  is_featured?: boolean; highlights?: string[]; agenda?: Agenda[]; interested?: boolean; interested_count?: number; comment_count?: number; invited_count?: number;
  attending_count?: number; can_manage?: boolean; group?: { id: string; name: string } | null;
  organizer?: { type: 'community' | 'member' | 'office'; id: string | null; name: string; members: number | null; photo: Img };
  description?: string; online_url?: string | null; gallery?: Img[]; custom_fields?: Record<string, unknown> | null; extra_fields?: ExtraField[];
  feedback?: { average: number | null; count: number; mine: { rating: number; comment: string | null } | null };
};

export const pick = (img: Img, w: number) => (img ? img.variants.find((v) => v.width >= w)?.url ?? img.url : undefined);
export const when = (e: Pick<EventT, 'starts_at' | 'ends_at'>) => {
  const s = new Date(e.starts_at);
  const sameDay = s.toDateString() === new Date(e.ends_at).toDateString();
  return `${s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${sameDay ? `–${new Date(e.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`;
};
export const EVENT_KIND_OPTIONS: [string, string][] = [['reunion', 'Reunion'], ['batch_reunion', 'Batch reunion'], ['networking', 'Networking'], ['webinar', 'Webinar'],
  ['seminar', 'Seminar'], ['workshop', 'Workshop'], ['school', 'School event'], ['sports', 'Sports & activities'], ['career', 'Career & jobs'], ['social_impact', 'Social impact'], ['other', 'Other']];
const CATEGORIES: { label: string; kinds: string }[] = [
  { label: 'Reunions', kinds: 'reunion,batch_reunion' }, { label: 'Networking', kinds: 'networking' }, { label: 'Webinars', kinds: 'webinar' },
  { label: 'Career & Jobs', kinds: 'career' }, { label: 'School Events', kinds: 'school' }, { label: 'Workshops', kinds: 'workshop,seminar' },
  { label: 'Sports & Activities', kinds: 'sports' }, { label: 'Social Impact', kinds: 'social_impact' },
];
const STATUS: Record<string, { tone: 'success' | 'warning' | 'neutral' | 'primary'; label: string }> = {
  registered: { tone: 'success', label: 'Attending' }, waitlisted: { tone: 'warning', label: 'Waitlisted' }, attended: { tone: 'primary', label: 'Attended' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};
const place = (e: EventT) => (e.is_online ? 'Online' : [e.venue, e.address].filter(Boolean).join(', '));
const going = (e: EventT) => !!e.my_registration && e.my_registration.status !== 'cancelled';

function useEventActions(e: EventT) {
  const inv = [['events'], ['event', e.id], ['events-summary'], ['events-featured']];
  const interest = useAction((on: boolean) => api(`/api/v1/events/${e.id}/interest`, { method: on ? 'POST' : 'DELETE' }),
    { success: (r) => ((r as { data: EventT }).data.interested ? 'Saved to your interested events.' : 'Removed from interested.'), invalidate: inv });
  return { interest };
}

function copyLink(id: string, toast: ReturnType<typeof useToast>) {
  navigator.clipboard?.writeText(`${location.origin}/portal/events/${id}`);
  toast.success('Event link copied.');
}

// ── list ────────────────────────────────────────────────────────────────────
function EventRow({ e }: { e: EventT }) {
  const toast = useToast();
  const nav = useNavigate();
  const { interest } = useEventActions(e);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row">
      <Link to={`/portal/events/${e.id}`} className="relative block aspect-[16/9] shrink-0 overflow-hidden rounded-card bg-gradient-to-br from-navy to-primary sm:aspect-auto sm:h-32 sm:w-48">
        {e.banner && <img src={pick(e.banner, 480)} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {e.status === 'cancelled' && <span className="absolute inset-0 grid place-items-center bg-navy-dark/70 font-semibold text-white">Cancelled</span>}
      </Link>
      <div className="min-w-0 flex-1">
        <Badge tone="primary">{e.kind_label}</Badge>
        <Link to={`/portal/events/${e.id}`} className="mt-1.5 block font-heading text-[17px] font-semibold leading-snug text-ink hover:text-primary">{e.title}</Link>
        {e.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{e.summary}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{when(e)}</span>
          <span className="flex min-w-0 items-center gap-1.5">{e.is_online ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}<span className="truncate">{place(e)}</span></span></p>
      </div>
      <div className="flex shrink-0 flex-row items-center gap-2 sm:w-40 sm:flex-col sm:items-stretch sm:justify-center">
        <p className="flex items-center gap-1.5 text-sm text-ink-muted sm:justify-center"><Users className="h-4 w-4" />{(e.attending_count ?? e.registered_count).toLocaleString()} attending</p>
        <div className="ms-auto flex gap-2 sm:ms-0">
          {going(e) ? <Badge tone={STATUS[e.my_registration!.status]!.tone} className="grid flex-1 place-items-center">{STATUS[e.my_registration!.status]!.label}</Badge>
            : !e.is_past && e.registration_open ? <Button size="sm" className="flex-1" onClick={() => nav(`/portal/events/${e.id}?rsvp=1`)}>RSVP</Button>
              : <Button size="sm" variant="outline" className="flex-1" onClick={() => nav(`/portal/events/${e.id}`)}>Details</Button>}
          <Menu>
            <MenuTrigger asChild><Button size="icon" variant="outline" className="h-8 w-8" aria-label={`More actions for ${e.title}`}><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => nav(`/portal/events/${e.id}`)}><Info />View details</MenuItem>
              <MenuItem onSelect={() => download(`/api/v1/events/${e.id}/calendar.ics`, `${e.title}.ics`)}><CalendarPlus />Add to calendar</MenuItem>
              <MenuItem onSelect={() => copyLink(e.id, toast)}><Copy />Copy link</MenuItem>
            </MenuContent>
          </Menu>
        </div>
        {!e.is_past && <Button size="sm" variant="outline" className={cn(e.interested && 'border-primary text-primary')} onClick={() => interest.mutate(!e.interested)}>
          {e.interested ? <BookmarkCheck /> : <Bookmark />}Interested</Button>}
      </div>
    </Card>
  );
}

function Featured() {
  const list = useQuery({ queryKey: ['events-featured'], queryFn: () => get<EventT[]>('/api/v1/events/featured'), staleTime: 60_000 });
  const [i, setI] = useState(0);
  const n = list.data?.length ?? 0;
  useEffect(() => { if (n < 2) return; const t = setInterval(() => setI((x) => (x + 1) % n), 6000); return () => clearInterval(t); }, [n]);
  if (!n) return null;
  const e = list.data![i % n]!;
  return (
    <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-navy to-primary" aria-roledescription="carousel" aria-label="Featured events">
      {e.banner && <img src={pick(e.banner, 1400)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-r from-navy-dark/90 via-navy-dark/60 to-transparent" />
      <div className="relative flex min-h-[230px] flex-col justify-end p-6 text-white sm:p-8">
        <Badge tone="primary" className="w-fit">Featured · {e.kind_label}</Badge>
        <h2 className="mt-3 max-w-xl font-heading text-2xl font-semibold sm:text-[28px]">{e.title}</h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90"><span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{when(e)}</span>
          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{place(e)}</span></p>
        <Button asChild variant="outline" className="mt-4 w-fit border-0 bg-white text-navy hover:bg-white/90"><Link to={`/portal/events/${e.id}`}>View Details<ArrowRight className="rtl:rotate-180" /></Link></Button>
      </div>
      {n > 1 && <div className="absolute bottom-4 end-6 flex gap-1.5">{list.data!.map((x, j) => <button key={x.id} aria-label={`Show featured event ${j + 1}`} aria-current={j === i % n}
        onClick={() => setI(j)} className={cn('h-2 rounded-full transition-all', j === i % n ? 'w-6 bg-white' : 'w-2 bg-white/50')} />)}</div>}
    </div>
  );
}

export function EventsPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') ?? 'upcoming';
  const kind = sp.get('kind') ?? '';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim());
  const set = (k: string, v: string | null) => { const nx = new URLSearchParams(sp); if (v) nx.set(k, v); else nx.delete(k); setSp(nx, { replace: true }); setPage(1); };
  const params = { scope, kind, q: dq, page, page_size: 10 };
  const list = useQuery({ queryKey: ['events', params], queryFn: () => api<Paged<EventT>>(`/api/v1/events${qs(params)}`), placeholderData: keepPreviousData });
  return (
    <PortalPage aside={<EventsAside scope={scope} kind={kind} onScope={(s) => set('scope', s === 'upcoming' ? null : s)} onKind={(k) => set('kind', k === kind ? null : k)} />}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-ink-muted">Events</p><h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Events</h1>
          <p className="mt-1 text-ink-muted">Discover and participate in alumni events, reunions, networking sessions and school activities.</p></div>
        {can('portal.events.register') && <Button onClick={() => set('create', '1')}><Plus />Create Event</Button>}
      </div>
      <Featured />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold text-ink">{scope === 'mine' ? 'My Events' : scope === 'interested' ? 'Interested' : scope === 'past' ? 'Past Events' : 'All Events'}</h2>
        <div className="relative sm:w-80"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search events" placeholder="Search events by name, location or keyword…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-10 ps-9" /></div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {[['upcoming', 'Upcoming'], ['mine', 'Attending'], ['interested', 'Interested'], ['past', 'Past']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={scope === k} onClick={() => set('scope', k === 'upcoming' ? null : k!)}
            className={cn('-mb-px shrink-0 border-b-2 px-4 py-2 text-[15px] font-medium', scope === k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>{l}</button>))}
      </div>
      {kind && <div className="flex items-center gap-2 text-sm"><span className="text-ink-muted">Category:</span><button onClick={() => set('kind', null)} className="flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 font-medium text-primary">
        {CATEGORIES.find((c) => c.kinds === kind)?.label ?? kind}<X className="h-3.5 w-3.5" /></button></div>}
      {list.isLoading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-card" />)}</div>
        : !list.data?.data.length ? <Card><EmptyState icon={CalendarDays} title="No events found" description={scope === 'upcoming' ? 'New events are announced here and by email.' : 'Try another tab or category.'} /></Card>
          : <div className="space-y-3">{list.data.data.map((e) => <EventRow key={e.id} e={e} />)}</div>}
      {list.data && list.data.meta.pages > 1 && <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
      {sp.get('create') === '1' && <CreateEventDialog onClose={() => set('create', null)} />}
    </PortalPage>
  );
}

function EventsAside({ scope, kind, onScope, onKind }: { scope: string; kind: string; onScope: (s: string) => void; onKind: (k: string) => void }) {
  const s = useQuery({ queryKey: ['events-summary'], queryFn: () => get<{ upcoming: number; attending: number; interested: number; past: number }>('/api/v1/events/summary') });
  const next = useQuery({ queryKey: ['events', 'aside-upcoming'], queryFn: () => get<EventT[]>('/api/v1/events?scope=upcoming&page_size=4') });
  const tiles: [string, string, number | undefined][] = [['upcoming', 'Upcoming', s.data?.upcoming], ['mine', 'Attending', s.data?.attending], ['interested', 'Interested', s.data?.interested], ['past', 'Past Events', s.data?.past]];
  return (
    <>
      <SectionCard title="My Events" icon={CalendarDays}>
        <div className="grid grid-cols-2 gap-2">{tiles.map(([k, l, v]) => (
          <button key={k} onClick={() => onScope(k)} aria-pressed={scope === k} className={cn('rounded-card border p-3 text-start', scope === k ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/50')}>
            <p className="font-heading text-2xl font-semibold text-ink">{v ?? '–'}</p><p className="text-sm text-ink-muted">{l}</p></button>))}</div>
      </SectionCard>
      <SectionCard title="Upcoming Events" icon={Clock}>
        {next.isLoading ? <Skeleton className="h-32" /> : !next.data?.length ? <p className="text-sm text-ink-muted">No upcoming events.</p> : (
          <ul className="space-y-3">{next.data.map((e) => (
            <li key={e.id} className="flex items-center gap-3">
              <span className="h-12 w-12 shrink-0 overflow-hidden rounded-btn bg-primary-soft">{e.banner ? <img src={pick(e.banner, 120)} alt="" className="h-full w-full object-cover" /> : <CalendarDays className="m-3 h-6 w-6 text-primary" />}</span>
              <div className="min-w-0 flex-1"><Link to={`/portal/events/${e.id}`} className="line-clamp-1 text-sm font-semibold text-ink hover:text-primary">{e.title}</Link>
                <p className="truncate text-xs text-ink-muted">{new Date(e.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} • {e.is_online ? 'Online' : e.venue}</p></div>
              <Button asChild size="sm" variant={going(e) ? 'outline' : 'primary'} className="h-8"><Link to={`/portal/events/${e.id}${going(e) ? '' : '?rsvp=1'}`}>{going(e) ? 'Going' : 'RSVP'}</Link></Button>
            </li>))}</ul>
        )}
      </SectionCard>
      <SectionCard title="Event Categories" icon={Sparkles}>
        <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => <button key={c.label} onClick={() => onKind(c.kinds)} aria-pressed={kind === c.kinds}
          className={cn('rounded-full border px-3 py-1.5 text-sm', kind === c.kinds ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink hover:border-primary/50')}>{c.label}</button>)}</div>
      </SectionCard>
    </>
  );
}

// ── detail ──────────────────────────────────────────────────────────────────
const HL_ICONS = [UsersRound, Utensils, Camera, Music, Gift, Sparkles];

export function EventPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'overview';
  const setTab = (t: string) => { const nx = new URLSearchParams(sp); if (t === 'overview') nx.delete('tab'); else nx.set('tab', t); setSp(nx, { replace: true }); };
  const [registering, setRegistering] = useState(sp.get('rsvp') === '1');
  const [inviting, setInviting] = useState(false);
  const q = useQuery({ queryKey: ['event', id], queryFn: () => get<EventT>(`/api/v1/events/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const cancel = useAction(() => api(`/api/v1/events/${id}/cancel`, { method: 'POST' }), { success: 'Registration cancelled.', invalidate: [['event', id], ['events'], ['events-summary']] });
  useRoom(q.data && going(q.data) ? `event:${id}` : null, { 'event:seats': () => q.refetch(), 'event:updated': () => q.refetch() });
  const e = q.data;
  const actions = useEventActions(e ?? ({ id: id ?? '' } as EventT));
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!e) return <Card><EmptyState icon={CalendarDays} title="Event not found" action={<Button asChild variant="outline"><Link to="/portal/events">All events</Link></Button>} /></Card>;
  const reg = going(e) ? e.my_registration! : null;
  const started = new Date(e.starts_at) <= new Date();
  const cancelReg = async () => { if (await confirm({ title: 'Cancel your registration?', description: 'Your place goes to the next person on the waitlist.', confirmLabel: 'Cancel registration', danger: true })) cancel.mutate(undefined); };
  const tabs = [{ k: 'overview', l: 'Overview' }, { k: 'discussion', l: `Discussion (${e.comment_count ?? 0})` }, { k: 'attendees', l: `Attendees (${e.attending_count ?? 0})` }, { k: 'photos', l: 'Photos' }, { k: 'files', l: 'Files' }];
  return (
    <PortalPage aside={<EventAside e={e} onRegister={() => setRegistering(true)} onCancel={cancelReg} onTab={setTab} />}>
      <nav className="text-sm text-ink-muted"><Link to="/portal/events" className="hover:text-ink">Events</Link> › <span className="text-ink">Event Details</span></nav>
      <Card className="overflow-hidden">
        <div className="relative min-h-[240px] bg-gradient-to-br from-navy to-primary sm:min-h-[300px]">
          {e.banner && <img src={pick(e.banner, 1600)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-navy-dark/90 via-navy-dark/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-7">
            <div className="flex flex-wrap gap-2"><Badge tone="primary">{e.kind_label}</Badge>{e.batch && <Badge tone="navy">{e.batch} only</Badge>}{e.status === 'pending' && <Badge tone="warning">Waiting for review</Badge>}</div>
            <h1 className="mt-2 font-heading text-2xl font-semibold sm:text-[32px]">{e.title}</h1>
            {e.summary && <p className="mt-1 max-w-2xl text-white/90">{e.summary}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
          <div className="flex flex-1 items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><CalendarDays className="h-5 w-5" /></span>
            <div><p className="font-semibold text-ink">{new Date(e.starts_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p className="text-sm text-ink-muted">{new Date(e.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – {new Date(e.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p></div></div>
          <div className="flex flex-1 items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary">{e.is_online ? <Video className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}</span>
            <div className="min-w-0"><p className="font-semibold text-ink">{e.is_online ? 'Online event' : e.venue}</p>{!e.is_online && e.address && <p className="text-sm text-ink-muted">{e.address}</p>}</div></div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => download(`/api/v1/events/${e.id}/calendar.ics`, `${e.title}.ics`)}><CalendarPlus />Add to Calendar</Button>
            <Button variant="outline" size="icon" aria-label="Share" onClick={() => copyLink(e.id, toast)}><Share2 /></Button>
            <Button variant="outline" size="icon" aria-label={e.interested ? 'Remove bookmark' : 'Bookmark'} className={cn(e.interested && 'border-primary text-primary')} onClick={() => actions.interest.mutate(!e.interested)}>{e.interested ? <BookmarkCheck /> : <Bookmark />}</Button>
            <Menu>
              <MenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
              <MenuContent>
                {!e.is_past && e.status === 'published' && <MenuItem onSelect={() => setInviting(true)}><UserPlus />Invite connections</MenuItem>}
                <MenuItem onSelect={() => copyLink(e.id, toast)}><Copy />Copy event link</MenuItem>
                {reg && !started && <><MenuSeparator /><MenuItem danger onSelect={cancelReg}><X />Cancel registration</MenuItem></>}
              </MenuContent>
            </Menu>
          </div>
        </div>
        {e.status === 'cancelled' && <Alert tone="danger" className="mx-5 mb-5" title="This event was cancelled">{e.cancel_reason}</Alert>}
        <div className="flex gap-1 overflow-x-auto border-t border-line px-3" role="tablist" aria-label="Event sections">
          {tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={cn('-mb-px shrink-0 border-b-2 px-3 py-3 text-[15px] font-medium', tab === t.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>{t.l}</button>)}
        </div>
      </Card>
      {tab === 'overview' && <>
        <SectionCard title="Event Details" icon={Info}>{e.description ? <RichText text={e.description} /> : <p className="text-sm text-ink-muted">{e.summary || 'More details coming soon.'}</p>}
          {!!e.highlights?.length && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{e.highlights.map((h, i) => { const I = HL_ICONS[i % HL_ICONS.length]!; return (
            <div key={h} className="flex flex-col items-center gap-2 rounded-card bg-canvas p-3 text-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-primary"><I className="h-5 w-5" /></span>
              <span className="text-sm font-medium text-ink">{h}</span></div>); })}</div>}
        </SectionCard>
        {!!e.agenda?.length && <SectionCard title="Agenda" icon={Clock}>
          <ol className="relative ms-2 border-s-2 border-primary-soft">{e.agenda.map((a, i) => (
            <li key={i} className="relative pb-4 ps-5 last:pb-0"><span className="absolute -start-[7px] top-1.5 h-3 w-3 rounded-full bg-primary ring-4 ring-surface" />
              <p className="text-sm font-semibold text-primary">{a.time}</p><p className="text-[15px] text-ink">{a.title}</p></li>))}</ol>
        </SectionCard>}
        <SectionCard title="Location" icon={MapPin}>
          {e.is_online ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><p className="flex-1 text-sm text-ink">This is an online event. The meeting link is shown to registered attendees.</p>
            {e.online_url && <Button asChild><a href={e.online_url} target="_blank" rel="noopener noreferrer"><Video />Join online</a></Button>}</div> : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="relative grid h-36 place-items-center overflow-hidden rounded-card bg-[linear-gradient(135deg,rgb(var(--primary-soft)),#e6f0ff)] sm:w-64">
                <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(#cbd5e1_1px,transparent_1px),linear-gradient(90deg,#cbd5e1_1px,transparent_1px)] [background-size:24px_24px]" />
                <MapPin className="relative h-10 w-10 fill-primary text-white" /></div>
              <div className="flex-1"><p className="font-semibold text-ink">{e.venue}</p><p className="text-sm text-ink-muted">{e.address}</p>
                <Button asChild variant="outline" className="mt-3"><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place(e))}`} target="_blank" rel="noopener noreferrer"><Navigation />Get Directions</a></Button></div>
            </div>)}
        </SectionCard>
        {!!e.extra_fields?.length && <SectionCard title="More details"><ExtraFields items={e.extra_fields} fileHref={(k) => `/api/v1/custom-fields/event/${e.id}/${k}/file`} /></SectionCard>}
        {reg && started && <Feedback e={e} />}
      </>}
      {tab === 'discussion' && <Discussion e={e} canPost={can('portal.react')} />}
      {tab === 'attendees' && <Attendees e={e} />}
      {tab === 'photos' && <Photos e={e} />}
      {tab === 'files' && <EventFiles e={e} />}
      {registering && e.registration_open && !reg && can('portal.events.register') && <RegisterDialog e={e} onClose={() => { setRegistering(false); if (sp.get('rsvp')) { const nx = new URLSearchParams(sp); nx.delete('rsvp'); setSp(nx, { replace: true }); } }} />}
      {inviting && <InviteDialog e={e} onClose={() => setInviting(false)} />}
    </PortalPage>
  );
}

function EventAside({ e, onRegister, onCancel, onTab }: { e: EventT; onRegister: () => void; onCancel: () => void; onTab: (t: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { interest } = useEventActions(e);
  const people = useQuery({ queryKey: ['event-attendees', e.id, ''], queryFn: () => get<Author[]>(`/api/v1/events/${e.id}/attendees?limit=8`) });
  const reg = going(e) ? e.my_registration! : null;
  const started = new Date(e.starts_at) <= new Date();
  const pill = e.status === 'cancelled' ? ['Cancelled', 'bg-danger/10 text-danger'] : e.status === 'pending' ? ['Waiting for review', 'bg-warning/15 text-warning']
    : e.is_past ? ['Event ended', 'bg-canvas text-ink-muted'] : e.registration_open ? [e.seats_left === 0 ? 'Full — waitlist open' : 'Open for RSVP', 'bg-success/10 text-success'] : ['Registration closed', 'bg-canvas text-ink-muted'];
  const o = e.organizer;
  const extra = Math.max(0, (e.attending_count ?? 0) - (people.data?.length ?? 0));
  const url = `${location.origin}/portal/events/${e.id}`;
  return (
    <>
      <SectionCard title="Event Status" icon={Ticket}>
        <span className={cn('inline-block rounded-full px-3 py-1 text-sm font-semibold', pill[1])}>{pill[0]}</span>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">{[['Attending', e.attending_count ?? 0], ['Interested', e.interested_count ?? 0], ['Invited', e.invited_count ?? 0]].map(([l, v]) => (
          <div key={l} className="rounded-card bg-canvas py-2"><p className="font-heading text-xl font-semibold text-ink">{v}</p><p className="text-xs text-ink-muted">{l}</p></div>))}</div>
        {reg ? (
          <div className="mt-4 text-center">
            <Badge tone={STATUS[reg.status]!.tone}>{STATUS[reg.status]!.label}{reg.guests ? ` · +${reg.guests} guest${reg.guests > 1 ? 's' : ''}` : ''}</Badge>
            {reg.status === 'waitlisted' ? <p className="mt-2 text-sm text-ink-muted">You will be registered automatically — and emailed — if a place frees up.</p> : reg.checkin_code && <>
              <div className="mx-auto mt-3 w-fit rounded-card border border-line bg-white p-3"><QRCodeSVG value={`sst-ticket:${reg.checkin_code}`} size={150} level="M" /></div>
              <p className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-muted"><Ticket className="h-3.5 w-3.5" />Show this code at the entrance · {reg.checkin_code.slice(0, 8).toUpperCase()}</p></>}
            {e.online_url && <Button asChild className="mt-3 w-full"><a href={e.online_url} target="_blank" rel="noopener noreferrer"><Video />Join online</a></Button>}
            {!started && <Button variant="ghost" className="mt-2 w-full" onClick={onCancel}><X />Cancel registration</Button>}
          </div>
        ) : e.registration_open && (
          can('portal.events.register') ? <Button className="mt-4 w-full" onClick={onRegister}><Check />{e.seats_left === 0 ? 'Join the Waitlist' : "RSVP – I'm Attending"}</Button>
            : <Alert tone="info" className="mt-4">Registration is open to verified members.</Alert>
        )}
        {!e.is_past && e.status === 'published' && <Button variant="outline" className={cn('mt-2 w-full', e.interested && 'border-primary text-primary')} onClick={() => interest.mutate(!e.interested)}>
          <Star className={cn(e.interested && 'fill-primary')} />{e.interested ? 'Interested' : "I'm Interested"}</Button>}
      </SectionCard>
      {o && <SectionCard title="Event Organizer" icon={UsersRound}>
        <div className="flex items-center gap-3">
          {o.photo ? <img src={pick(o.photo, 120)} alt="" className="h-12 w-12 rounded-full object-cover" /> : <Avatar name={o.name} size={48} />}
          <div className="min-w-0"><p className="flex items-center gap-1.5 truncate font-semibold text-ink">{o.name}{o.type !== 'member' && <VerifiedBadge />}</p>
            <p className="text-sm text-ink-muted">{o.type === 'community' ? `Community • ${o.members?.toLocaleString()} members` : o.type === 'member' ? 'Alumni member' : 'Official event'}</p></div>
        </div>
        {o.type !== 'office' && o.id && <Button asChild variant="outline" className="mt-3 w-full border-primary/50 text-primary">
          <Link to={o.type === 'community' ? `/portal/community/groups/${o.id}` : `/portal/alumni/${o.id}`}>{o.type === 'community' ? 'View Community' : 'View Profile'}<ArrowRight className="rtl:rotate-180" /></Link></Button>}
      </SectionCard>}
      {!!people.data?.length && <SectionCard title="Attendees" icon={Users} action={<button className="text-sm font-semibold text-primary hover:underline" onClick={() => onTab('attendees')}>View All</button>}>
        <div className="flex items-center">{people.data.slice(0, 7).map((m, i) => <Link key={m.id} to={`/portal/alumni/${m.id}`} title={m.full_name} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ms-2.5')}><Avatar name={m.full_name} src={photoUrl(m.photo, 80)} size={38} /></Link>)}
          {extra > 0 && <span className="-ms-2.5 grid h-[38px] min-w-[38px] place-items-center rounded-full bg-primary-soft px-1.5 text-xs font-semibold text-primary ring-2 ring-surface">+{extra}</span>}</div>
      </SectionCard>}
      <SectionCard title="Share this Event" icon={Share2}>
        <div className="flex gap-2">{[['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${e.title} ${url}`)}`], ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`],
          ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`], ['X', `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(e.title)}`]].map(([l, h]) => (
          <a key={l} href={h} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-btn border border-line py-2 text-center text-xs font-medium text-ink hover:border-primary hover:text-primary">{l}</a>))}</div>
        <Button variant="outline" className="mt-2 w-full" onClick={() => copyLink(e.id, toast)}><Copy />Copy Event Link</Button>
      </SectionCard>
    </>
  );
}

type CommentT = { id: string; body: string; author: Author | null; created_at: string; can_delete: boolean };

function Discussion({ e, canPost }: { e: EventT; canPost: boolean }) {
  const [body, setBody] = useState('');
  const list = useQuery({ queryKey: ['event-comments', e.id], queryFn: () => get<CommentT[]>(`/api/v1/events/${e.id}/comments`) });
  const add = useAction(() => api(`/api/v1/events/${e.id}/comments`, { method: 'POST', body: { body } }), { invalidate: [['event-comments', e.id], ['event', e.id]], onSuccess: () => setBody('') });
  const del = useAction((cid: string) => api(`/api/v1/events/${e.id}/comments/${cid}`, { method: 'DELETE' }), { success: 'Comment deleted.', invalidate: [['event-comments', e.id], ['event', e.id]] });
  return (
    <Card className="p-4">
      {canPost && <div className="flex gap-3 border-b border-line pb-4"><Textarea aria-label="Write a comment" placeholder="Ask a question or share something about this event…" value={body} maxLength={2000} onChange={(x) => setBody(x.target.value)} className="min-h-[70px]" />
        <Button className="self-end" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate(undefined)}>Post</Button></div>}
      {list.isLoading ? <Skeleton className="mt-4 h-24" /> : !list.data?.length ? <EmptyState icon={MessageCircle} title="No comments yet" description="Start the conversation." /> : (
        <ul className="divide-y divide-line">{list.data.map((c) => (
          <li key={c.id} className="flex gap-3 py-3"><Avatar name={c.author?.full_name} src={photoUrl(c.author?.photo ?? null, 80)} size={38} />
            <div className="min-w-0 flex-1"><p className="text-sm"><span className="font-semibold text-ink">{c.author?.full_name ?? 'Member'}</span> <span className="text-xs text-ink-muted">· {timeAgo(c.created_at)}</span></p>
              <p className="whitespace-pre-line text-[15px] text-ink">{c.body}</p></div>
            {c.can_delete && <Button size="icon" variant="ghost" aria-label="Delete comment" onClick={() => del.mutate(c.id)}><Trash2 /></Button>}</li>))}</ul>
      )}
    </Card>
  );
}

function Attendees({ e }: { e: EventT }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const list = useQuery({ queryKey: ['event-attendees', e.id, dq], queryFn: () => get<Author[]>(`/api/v1/events/${e.id}/attendees${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-heading text-lg font-semibold text-ink">Attendees ({e.attending_count ?? 0})</h2>
        <div className="relative sm:w-64"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input aria-label="Search attendees" placeholder="Search attendees…" value={q} onChange={(x) => setQ(x.target.value)} className="h-9 ps-9" /></div></div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !list.data?.length ? <EmptyState icon={Users} title="No attendees yet" description="Be the first to RSVP." /> : (
        <ul className="grid gap-2 p-4 sm:grid-cols-2">{list.data.map((p) => (
          <li key={p.id}><Link to={`/portal/alumni/${p.id}`} className="flex items-center gap-3 rounded-card p-2 hover:bg-canvas"><Avatar name={p.full_name} src={photoUrl(p.photo, 80)} size={42} />
            <span className="min-w-0"><span className="flex items-center gap-1 truncate font-medium text-ink">{p.full_name}{p.verified && <VerifiedBadge />}</span><span className="block truncate text-xs text-ink-muted">{p.headline ?? p.batch}</span></span></Link></li>))}</ul>
      )}
    </Card>
  );
}

function Uploader({ label, accept, endpoint, invalidate }: { label: string; accept: string; endpoint: string; invalidate: unknown[][] }) {
  const ref = useRef<HTMLInputElement>(null);
  const up = useAction(async (f: File) => { const fd = new FormData(); fd.append('file', f); return api(endpoint, { method: 'POST', body: fd }); }, { success: 'Uploaded.', invalidate: invalidate as never });
  return <><Button size="sm" loading={up.isPending} onClick={() => ref.current?.click()}><Plus />{label}</Button>
    <input ref={ref} type="file" accept={accept} hidden onChange={(x) => { const f = x.target.files?.[0]; x.target.value = ''; if (f) up.mutate(f); }} /></>;
}

function Photos({ e }: { e: EventT }) {
  const [open, setOpen] = useState<number | null>(null);
  const g = (e.gallery ?? []).filter(Boolean);
  return (
    <Card className="p-4">
      {e.can_manage && <div className="mb-3 flex justify-end"><Uploader label="Add Photo" accept="image/*" endpoint={`/api/v1/events/${e.id}/photos`} invalidate={[['event', e.id]]} /></div>}
      {!g.length ? <EmptyState icon={ImageIcon} title="No photos yet" description="Photos from the event appear here." /> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{g.map((x, i) => <button key={x!.id} onClick={() => setOpen(i)} className="overflow-hidden rounded-btn" aria-label={`Open photo ${i + 1}`}>
          <img src={pick(x, 480)} alt={x!.alt} loading="lazy" className="aspect-[4/3] w-full object-cover transition hover:scale-105" /></button>)}</div>
      )}
      {open !== null && g[open] && (
        <Dialog open onOpenChange={(v) => !v && setOpen(null)} title={`Photo ${open + 1} of ${g.length}`} wide
          footer={<><Button variant="outline" onClick={() => setOpen((open + g.length - 1) % g.length)}><ChevronLeft />Previous</Button><Button variant="outline" onClick={() => setOpen((open + 1) % g.length)}>Next<ChevronRight /></Button></>}>
          <img src={pick(g[open] ?? null, 1920)} alt="" className="mx-auto max-h-[70vh]" />
        </Dialog>
      )}
    </Card>
  );
}

type FileRow = { id: string; filename: string; mime: string; size: number; url: string; created_at: string };

function EventFiles({ e }: { e: EventT }) {
  const list = useQuery({ queryKey: ['event-files', e.id], queryFn: () => get<FileRow[]>(`/api/v1/events/${e.id}/files`) });
  const del = useAction((mid: string) => api(`/api/v1/events/${e.id}/files/${mid}`, { method: 'DELETE' }), { success: 'File removed.', invalidate: [['event-files', e.id]] });
  return (
    <Card>
      {e.can_manage && <div className="flex justify-end border-b border-line p-3"><Uploader label="Upload File" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" endpoint={`/api/v1/events/${e.id}/files`} invalidate={[['event-files', e.id]]} /></div>}
      {list.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !list.data?.length ? <EmptyState icon={Files} title="No files" description="Agendas, forms and other documents from the organisers appear here." /> : (
        <ul className="divide-y divide-line">{list.data.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><FileText className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{f.filename}</p><p className="text-xs text-ink-muted">{fileSize(f.size)} · {timeAgo(f.created_at)}</p></div>
            <Button asChild size="sm" variant="outline"><a href={f.url} target="_blank" rel="noopener noreferrer" download={f.filename}><Download />Download</a></Button>
            {e.can_manage && <Button size="icon" variant="ghost" aria-label={`Remove ${f.filename}`} onClick={() => del.mutate(f.id)}><Trash2 /></Button>}</li>))}</ul>
      )}
    </Card>
  );
}

function InviteDialog({ e, onClose }: { e: EventT; onClose: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [picked, setPicked] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['event-invitable', e.id, dq], queryFn: () => get<(Author & { invited: boolean })[]>(`/api/v1/events/${e.id}/invitable${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  const send = useAction(() => api<{ data: { sent: number } }>(`/api/v1/events/${e.id}/invite`, { method: 'POST', body: { user_ids: picked } }),
    { success: (r) => `${r.data.sent} invitation${r.data.sent === 1 ? '' : 's'} sent.`, invalidate: [['event', e.id]], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Invite to ${e.title}`} description="Invite your connections. They get a notification with the event link."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!picked.length} loading={send.isPending} onClick={() => send.mutate(undefined)}><UserPlus />Send Invites{picked.length ? ` (${picked.length})` : ''}</Button></>}>
      <Input aria-label="Search connections" placeholder="Search your connections…" value={q} onChange={(x) => setQ(x.target.value)} />
      <div className="mt-3 max-h-80 overflow-y-auto">{list.isLoading ? <Skeleton className="h-24" /> : !list.data?.length ? <p className="py-6 text-center text-sm text-ink-muted">No connections to invite.</p> : (
        <ul className="divide-y divide-line">{list.data.map((p) => <li key={p.id}><label className={cn('flex items-center gap-3 py-2.5', p.invited ? 'opacity-60' : 'cursor-pointer')}>
          <input type="checkbox" disabled={p.invited} checked={picked.includes(p.id)} onChange={(x) => setPicked(x.target.checked ? [...picked, p.id] : picked.filter((y) => y !== p.id))} className="h-4 w-4 accent-[rgb(var(--primary))]" aria-label={`Invite ${p.full_name}`} />
          <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={34} /><span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.full_name}</span>{p.invited && <Badge>Invited</Badge>}</label></li>)}</ul>)}</div>
    </Dialog>
  );
}

/** Highlights + agenda editors (member proposals and the admin form). */
export function EventExtrasEditor({ highlights, agenda, onHighlights, onAgenda }: { highlights: string[]; agenda: Agenda[]; onHighlights: (v: string[]) => void; onAgenda: (v: Agenda[]) => void }) {
  const [h, setH] = useState('');
  const addH = () => { const v = h.trim(); if (v && !highlights.includes(v) && highlights.length < 10) onHighlights([...highlights, v.slice(0, 60)]); setH(''); };
  return (
    <div className="space-y-4">
      <div><p className="mb-1.5 text-[13px] font-medium text-ink">Highlights</p>
        <div className="flex flex-wrap gap-1.5">{highlights.map((x) => <span key={x} className="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-sm text-primary">{x}
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onHighlights(highlights.filter((y) => y !== x))}><X className="h-3 w-3" /></button></span>)}</div>
        <div className="mt-2 flex gap-2"><Input aria-label="Add highlight" placeholder="e.g. Dinner & refreshments" value={h} onChange={(x) => setH(x.target.value)} onKeyDown={(x) => { if (x.key === 'Enter') { x.preventDefault(); addH(); } }} />
          <Button type="button" variant="outline" onClick={addH}>Add</Button></div></div>
      <div><p className="mb-1.5 text-[13px] font-medium text-ink">Agenda</p>
        <div className="space-y-2">{agenda.map((a, i) => <div key={i} className="flex gap-2">
          <Input aria-label={`Agenda time ${i + 1}`} placeholder="7:00 PM" value={a.time} maxLength={20} className="w-28" onChange={(x) => onAgenda(agenda.map((y, j) => (j === i ? { ...y, time: x.target.value } : y)))} />
          <Input aria-label={`Agenda item ${i + 1}`} placeholder="Welcome & registration" value={a.title} maxLength={150} onChange={(x) => onAgenda(agenda.map((y, j) => (j === i ? { ...y, title: x.target.value } : y)))} />
          <Button type="button" size="icon" variant="ghost" aria-label="Remove agenda item" onClick={() => onAgenda(agenda.filter((_, j) => j !== i))}><X /></Button></div>)}</div>
        {agenda.length < 30 && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => onAgenda([...agenda, { time: '', title: '' }])}><Plus />Add agenda item</Button>}</div>
    </div>
  );
}

function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [f, setF] = useState({ title: '', kind: 'reunion', starts: '', ends: '', venue: '', address: '', is_online: false, online_url: '', summary: '', description: '', capacity: '' });
  const [highlights, setHighlights] = useState<string[]>([]);
  const [agenda, setAgenda] = useState<Agenda[]>([]);
  const [banner, setBanner] = useState<{ id: string; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const save = useAction(() => api<{ data: EventT }>('/api/v1/events', { method: 'POST', body: {
    title: f.title, kind: f.kind, starts_at: iso(f.starts), ends_at: iso(f.ends), venue: f.venue || null, address: f.address || null, is_online: f.is_online,
    online_url: f.online_url || null, summary: f.summary, description: f.description, capacity: f.capacity ? Number(f.capacity) : null, banner_id: banner?.id ?? null,
    highlights, agenda: agenda.filter((a) => a.title.trim()) } }),
  { invalidate: [['events']], onSuccess: (r) => { toast.success(r.data.status === 'pending' ? 'Thanks! The alumni office will review your event.' : 'Event published.'); onClose(); nav(`/portal/events/${r.data.id}`); } });
  const upload = async (file: File) => { try { const fd = new FormData(); fd.append('file', file); const r = await api<{ data: { id: string; url: string } }>('/api/v1/community/uploads', { method: 'POST', body: fd }); setBanner(r.data); } catch (x) { toast.error(x instanceof Error ? x.message : 'Upload failed.'); } };
  const e = save.fieldErrors;
  const ok = f.title.trim().length >= 3 && f.starts && f.ends && (f.is_online || f.venue.trim());
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Create an event" description={can('events.publish') ? undefined : 'Events created by members are published after the alumni office reviews them.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate(undefined)}><CalendarDays />{can('events.publish') ? 'Publish Event' : 'Submit for Review'}</Button></>}>
      <div className="space-y-4">
        {save.error && !Object.keys(e).length && <Alert tone="danger">{save.error.message}</Alert>}
        <button type="button" onClick={() => fileRef.current?.click()} className="relative grid h-32 w-full place-items-center overflow-hidden rounded-card border-2 border-dashed border-line bg-canvas text-sm text-ink-muted hover:border-primary">
          {banner ? <img src={banner.url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="flex items-center gap-2"><Camera className="h-5 w-5" />Upload a cover photo</span>}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(x) => { const file = x.target.files?.[0]; x.target.value = ''; if (file) upload(file); }} />
        <Field label="Event title" required error={e.title}>{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{EVENT_KIND_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Starts" required error={e.starts_at}>{(id) => <Input id={id} type="datetime-local" value={f.starts} onChange={(x) => setF({ ...f, starts: x.target.value })} />}</Field>
          <Field label="Ends" required error={e.ends_at}>{(id) => <Input id={id} type="datetime-local" value={f.ends} min={f.starts} onChange={(x) => setF({ ...f, ends: x.target.value })} />}</Field>
        </div>
        <Checkbox checked={f.is_online} onCheckedChange={(v) => setF({ ...f, is_online: v })} label="Online event" />
        {f.is_online ? <Field label="Meeting link" hint="Shown to registered attendees only." error={e.online_url}>{(id) => <Input id={id} value={f.online_url} placeholder="https://" onChange={(x) => setF({ ...f, online_url: x.target.value })} />}</Field>
          : <div className="grid gap-4 sm:grid-cols-2"><Field label="Venue" required error={e.venue}>{(id) => <Input id={id} value={f.venue} maxLength={200} onChange={(x) => setF({ ...f, venue: x.target.value })} />}</Field>
            <Field label="Address / city">{(id) => <Input id={id} value={f.address} maxLength={300} onChange={(x) => setF({ ...f, address: x.target.value })} />}</Field></div>}
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <Field label="Short description" hint="Shown on event cards." error={e.summary}>{(id) => <Input id={id} value={f.summary} maxLength={300} onChange={(x) => setF({ ...f, summary: x.target.value })} />}</Field>
          <Field label="Capacity" hint="Empty = unlimited">{(id) => <Input id={id} type="number" min={1} value={f.capacity} onChange={(x) => setF({ ...f, capacity: x.target.value })} />}</Field>
        </div>
        <Field label="Event details" error={e.description}>{(id) => <Textarea id={id} value={f.description} maxLength={20000} onChange={(x) => setF({ ...f, description: x.target.value })} className="min-h-[110px]" />}</Field>
        <EventExtrasEditor highlights={highlights} agenda={agenda} onHighlights={setHighlights} onAgenda={setAgenda} />
      </div>
    </Dialog>
  );
}

function RegisterDialog({ e, onClose }: { e: EventT; onClose: () => void }) {
  const [guests, setGuests] = useState('0');
  const [note, setNote] = useState('');
  const reg = useAction(() => api<{ data: EventT }>(`/api/v1/events/${e.id}/register`, { method: 'POST', body: { guests: Number(guests), note: note || null } }),
    { success: (r) => (r.data.my_registration?.status === 'waitlisted' ? 'You are on the waitlist.' : 'You are registered — your ticket is ready.'),
      invalidate: [['event', e.id], ['events'], ['events-summary'], ['event-attendees', e.id], ['alumni-dashboard']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`RSVP for ${e.title}`} description={when(e)}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={reg.isPending} onClick={() => reg.mutate(undefined)}>{e.seats_left === 0 ? 'Join waitlist' : 'Confirm RSVP'}</Button></>}>
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
    <SectionCard title="How was it?" icon={Star}>
      <p className="text-sm text-ink-muted">{e.feedback?.count ? `${e.feedback.average} ★ from ${e.feedback.count} attendee(s)` : 'Your feedback helps us plan better events.'}</p>
      <div className="mt-3 space-y-3">
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}><Star className={cn('h-7 w-7', n <= rating ? 'fill-warning text-warning' : 'text-line')} /></button>))}</div>
        <Textarea aria-label="Comment" placeholder="What did you enjoy? What could be better?" value={comment} onChange={(x) => setComment(x.target.value)} maxLength={2000} />
        <Button disabled={!rating} loading={save.isPending} onClick={() => save.mutate(undefined)}>{mine ? 'Update feedback' : 'Send feedback'}</Button>
      </div>
    </SectionCard>
  );
}


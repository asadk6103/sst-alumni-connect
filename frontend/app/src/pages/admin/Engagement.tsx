import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Briefcase, Building2, CalendarDays, Camera, Check, Download, Eye, ImagePlus, Medal, Pencil, Plus, QrCode, Search, Send, Star, Trash2,
  Undo2, Users, UsersRound, X } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl, type PersonCard } from '@/lib/alumni';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { CustomFieldsForm, customErrors, useCustomFields, type CustomValues } from '@/components/customFields';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import type { Author } from '@/components/community';
import { pick, when, type EventT } from '@/pages/portal/Events';
import { TYPE_LABEL, type Job } from '@/pages/portal/Jobs';
import { Stars, type MentorT } from '@/pages/portal/Mentorship';
import { ACH_KINDS, type AchievementT } from '@/pages/portal/Achievements';

const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', 'events');
  const r = await api<{ data: { id: string } }>('/api/v1/admin/media', { method: 'POST', body: fd });
  return r.data.id;
}

// ── events ──────────────────────────────────────────────────────────────────
type AdminEvent = EventT & { counts: Record<string, number> };
const EVENT_KINDS: [string, string][] = [['reunion', 'Annual reunion'], ['batch_reunion', 'Batch reunion'], ['networking', 'Networking'], ['seminar', 'Seminar'],
  ['webinar', 'Webinar'], ['sports', 'Sports'], ['career', 'Career guidance'], ['other', 'Other']];

export function EventsAdminPage() {
  const { id } = useParams();
  return id ? <EventManage id={id} /> : <EventsList />;
}

function EventsList() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('upcoming');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const dq = useDebounced(q);
  const params = { status, scope, q: dq, page };
  const list = useQuery({ queryKey: ['admin-events', params], queryFn: () => api<Paged<AdminEvent>>(`/api/v1/admin/events${qs(params)}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Events Management" description="Reunions, webinars, seminars and sports — registrations, attendance and galleries."
        actions={can('events.create') && <Button onClick={() => setEditing('new')}><Plus />New event</Button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search events" placeholder="Search events…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
          <Select aria-label="When" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }} className="md:w-36"><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="">All</option></Select>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-40"><option value="">Any status</option><option value="draft">Draft</option><option value="published">Published</option><option value="cancelled">Cancelled</option></Select>
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(e) => e.id}
          empty={<EmptyState icon={CalendarDays} title="No events" description="Create the first event — it stays a draft until you publish it." />}
          columns={[
            { key: 'title', header: 'Event', cell: (e) => <Link to={`/admin/events/${e.id}`} className="block max-w-xs"><p className="font-medium text-primary hover:underline">{e.title}</p><p className="text-xs text-ink-muted">{e.kind_label}{e.batch ? ` · ${e.batch}` : ''}</p></Link> },
            { key: 'when', header: 'When', cell: (e) => <span className="text-sm">{fmtDateTime(e.starts_at)}</span> },
            { key: 'status', header: 'Status', cell: (e) => <Badge tone={e.status === 'published' ? 'success' : e.status === 'draft' ? 'warning' : 'neutral'} className="capitalize">{e.status}</Badge> },
            { key: 'regs', header: 'Registrations', cell: (e) => <span className="text-sm">{e.counts.registered + e.counts.attended}{e.capacity ? ` / ${e.capacity}` : ''}{e.counts.waitlisted ? <span className="text-ink-muted"> · {e.counts.waitlisted} waitlisted</span> : ''}</span> },
            { key: 'att', header: 'Attended', hideOnMobile: true, cell: (e) => e.counts.attended },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (e) => <Button size="sm" variant="outline" asChild><Link to={`/admin/events/${e.id}`}>Manage</Link></Button> },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {editing && <EventForm id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EventForm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const nav = useNavigate();
  const existing = useQuery({ queryKey: ['admin-event', id], queryFn: () => get<EventT & { banner_id: string | null }>(`/api/v1/admin/events/${id}`), enabled: !!id });
  const batches = useQuery({ queryKey: ['admin-batches-brief'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/admin/batches') });
  if (id && !existing.data) return null;
  return <EventFormInner e={existing.data} batches={batches.data ?? []} onClose={onClose} onSaved={(nid) => { onClose(); if (!id) nav(`/admin/events/${nid}`); }} />;
}

function EventFormInner({ e, batches, onClose, onSaved }: { e?: EventT & { banner_id: string | null }; batches: { id: string; name: string }[]; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: e?.title ?? '', kind: e?.kind ?? 'reunion', summary: e?.summary ?? '', description: e?.description ?? '', banner_id: e?.banner_id ?? null as string | null,
    starts_at: toLocal(e?.starts_at), ends_at: toLocal(e?.ends_at), venue: e?.venue ?? '', address: e?.address ?? '', is_online: e?.is_online ?? false,
    online_url: e?.online_url ?? '', capacity: e?.capacity ? String(e.capacity) : '', max_guests: String(e?.max_guests ?? 0),
    registration_deadline: toLocal(e?.registration_deadline), batch_id: e?.batch_id ?? '',
  });
  const [banner, setBanner] = useState<string | null>(e?.banner ? pick(e.banner, 800) ?? null : null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const defs = useCustomFields('event');
  const [extra, setExtra] = useState<CustomValues>(e?.custom_fields ?? {});
  const save = useAction(() => api<{ data: EventT }>(e ? `/api/v1/admin/events/${e.id}` : '/api/v1/admin/events', { method: e ? 'PUT' : 'POST', body: {
    ...f, starts_at: fromLocal(f.starts_at), ends_at: fromLocal(f.ends_at), registration_deadline: fromLocal(f.registration_deadline),
    capacity: f.capacity ? Number(f.capacity) : null, max_guests: Number(f.max_guests), online_url: f.online_url || null, venue: f.venue || null,
    address: f.address || null, batch_id: f.batch_id || null, custom_fields: extra,
  } }), { success: e ? 'Event saved.' : 'Event created as a draft.', invalidate: [['admin-events'], ['admin-event'], ['events']], onSuccess: (r) => onSaved(r.data.id) });
  const err = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={e ? `Edit ${e.title}` : 'New event'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && !Object.keys(err).length && <Alert tone="danger" className="sm:col-span-2">{save.error.message}</Alert>}
        <Field label="Title" required error={err.title} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(x) => set('title', x.target.value)} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(x) => set('kind', x.target.value)}>{EVENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <Field label="Only for batch" hint="Leave empty for everyone.">{(id, d) => <Select id={id} aria-describedby={d} value={f.batch_id} onChange={(x) => set('batch_id', x.target.value)}><option value="">All alumni</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
        <Field label="Starts" required error={err.starts_at}>{(id) => <Input id={id} type="datetime-local" value={f.starts_at} onChange={(x) => set('starts_at', x.target.value)} />}</Field>
        <Field label="Ends" required error={err.ends_at}>{(id) => <Input id={id} type="datetime-local" value={f.ends_at} onChange={(x) => set('ends_at', x.target.value)} />}</Field>
        <div className="sm:col-span-2"><Checkbox checked={f.is_online} onCheckedChange={(v) => set('is_online', v)} label="Online event (webinar)" /></div>
        {f.is_online ? <Field label="Meeting link" hint="Shown to registered attendees only." error={err.online_url} className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} value={f.online_url} placeholder="https://…" onChange={(x) => set('online_url', x.target.value)} />}</Field>
          : <><Field label="Venue" required error={err.venue}>{(id) => <Input id={id} value={f.venue} onChange={(x) => set('venue', x.target.value)} />}</Field>
            <Field label="Address">{(id) => <Input id={id} value={f.address} onChange={(x) => set('address', x.target.value)} />}</Field></>}
        <Field label="Capacity" hint="Empty = unlimited. Extra registrations join a waitlist." error={err.capacity}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} value={f.capacity} onChange={(x) => set('capacity', x.target.value)} />}</Field>
        <Field label="Guests per attendee">{(id) => <Input id={id} type="number" min={0} max={10} value={f.max_guests} onChange={(x) => set('max_guests', x.target.value)} />}</Field>
        <Field label="Registration closes" error={err.registration_deadline}>{(id) => <Input id={id} type="datetime-local" value={f.registration_deadline} onChange={(x) => set('registration_deadline', x.target.value)} />}</Field>
        <div className="space-y-1.5"><p className="text-[13px] font-medium text-ink">Banner</p>
          <div className="flex items-center gap-2">{banner && <img src={banner} alt="" className="h-10 w-16 rounded object-cover" />}
            <Button size="sm" variant="outline" loading={uploading} onClick={() => fileRef.current?.click()}><ImagePlus />{banner ? 'Change' : 'Upload'}</Button>
            {banner && <Button size="sm" variant="ghost" onClick={() => { set('banner_id', null); setBanner(null); }}>Remove</Button>}</div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (x) => { const file = x.target.files?.[0]; x.target.value = ''; if (!file) return; setUploading(true);
            try { const mid = await uploadImage(file); set('banner_id', mid); setBanner(URL.createObjectURL(file)); } catch (err2) { toast.error(err2 instanceof Error ? err2.message : 'Upload failed.'); } finally { setUploading(false); } }} /></div>
        <Field label="Summary" hint="One line shown on event cards." className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} value={f.summary} maxLength={300} onChange={(x) => set('summary', x.target.value)} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} maxLength={20000} onChange={(x) => set('description', x.target.value)} className="min-h-[140px]" />}</Field>
        {!!defs.data?.length && <div className="border-t border-line pt-4 sm:col-span-2"><CustomFieldsForm defs={defs.data} value={extra} onChange={setExtra} errors={customErrors(err)} /></div>}
      </div>
    </Dialog>
  );
}

type Reg = { id: string; user: Author | null; email: string; phone: string | null; status: string; guests: number; note: string | null; registered_at: string; checked_in_at: string | null };

function EventManage({ id }: { id: string }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [tab, setTab] = useState('registrations');
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const ev = useQuery({ queryKey: ['admin-event', id], queryFn: () => get<EventT & { banner_id: string | null }>(`/api/v1/admin/events/${id}`) });
  const publish = useAction(() => api(`/api/v1/admin/events/${id}/publish`, { method: 'POST' }), { success: 'Event published.', invalidate: [['admin-event', id], ['admin-events']] });
  const del = useAction(() => api(`/api/v1/admin/events/${id}`, { method: 'DELETE' }), { success: 'Draft deleted.', invalidate: [['admin-events']], onSuccess: () => history.back() });
  const e = ev.data;
  if (!e) return <Skeleton className="h-64 rounded-card" />;
  return (
    <>
      <PageHeader title={e.title} breadcrumb={<Link to="/admin/events" className="hover:text-ink">Events</Link>} description={`${e.kind_label} · ${when(e)} · ${e.is_online ? 'Online' : e.venue}`}
        actions={<>
          {e.status === 'draft' && can('events.publish') && <Button onClick={() => publish.mutate(undefined)}><Send />Publish</Button>}
          {can('events.edit') && e.status !== 'cancelled' && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />Edit</Button>}
          {can('events.edit') && e.status === 'published' && <Button variant="danger-outline" onClick={() => setCancelling(true)}><Ban />Cancel event</Button>}
          {can('events.delete') && e.status === 'draft' && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete this draft?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}><Trash2 />Delete</Button>}
        </>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <StatTile icon={Users} value={e.registered_count} label={e.capacity ? `of ${e.capacity} seats taken` : 'Seats taken'} />
        <StatTile icon={Check} tone="success" value={e.status} label="Status" />
        <StatTile icon={Star} tone="warning" value={e.feedback?.average ?? '—'} label={`Rating (${e.feedback?.count ?? 0})`} />
        <StatTile icon={CalendarDays} tone="navy" value={fmtDate(e.starts_at)} label="Date" />
      </div>
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'registrations', label: 'Registrations' }, { value: 'checkin', label: 'Check-in' }, { value: 'gallery', label: 'Gallery' }, { value: 'feedback', label: 'Feedback' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'checkin' ? <CheckIn e={e} /> : tab === 'gallery' ? <Gallery e={e} /> : tab === 'feedback' ? <EventFeedbackList id={id} /> : <Registrations e={e} />}</div>
      {editing && <EventFormInner e={e} batches={[]} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {cancelling && <CancelEvent id={id} onClose={() => setCancelling(false)} />}
    </>
  );
}

function CancelEvent({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const run = useAction(() => api(`/api/v1/admin/events/${id}/cancel`, { method: 'POST', body: { reason } }), { success: 'Event cancelled; registrants were emailed.', invalidate: [['admin-event', id], ['admin-events']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Cancel event" description="Everyone registered or waitlisted is emailed this reason."
      footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={run.isPending} onClick={() => run.mutate(undefined)}>Cancel event</Button></>}>
      <Textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. The venue is unavailable; a new date will be announced." />
    </Dialog>
  );
}

function Registrations({ e }: { e: EventT }) {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const params = { status, q: dq, page, page_size: 25 };
  const list = useQuery({ queryKey: ['admin-event-regs', e.id, params], queryFn: () => api<Paged<Reg>>(`/api/v1/admin/events/${e.id}/registrations${qs(params)}`), placeholderData: keepPreviousData });
  const check = useAction(({ uid, undo }: { uid: string; undo?: boolean }) => undo ? api(`/api/v1/admin/events/${e.id}/checkin/${uid}`, { method: 'DELETE' }) : api(`/api/v1/admin/events/${e.id}/checkin`, { method: 'POST', body: { user_id: uid } }),
    { invalidate: [['admin-event-regs', e.id]] });
  const TONE: Record<string, 'success' | 'warning' | 'neutral' | 'primary'> = { registered: 'success', waitlisted: 'warning', cancelled: 'neutral', attended: 'primary' };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
        <Input aria-label="Search attendees" placeholder="Search name or email…" value={q} onChange={(x) => { setQ(x.target.value); setPage(1); }} className="md:max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(x) => { setStatus(x.target.value); setPage(1); }} className="md:w-44"><option value="">All</option><option value="registered">Registered</option><option value="attended">Attended</option><option value="waitlisted">Waitlisted</option><option value="cancelled">Cancelled</option></Select>
        {can('events.export') && <Button variant="outline" className="md:ml-auto" onClick={() => download(`/api/v1/admin/events/${e.id}/registrations/export`, `${e.title}-registrations.csv`)}><Download />Export CSV</Button>}
      </div>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} empty={<EmptyState icon={Users} title="No registrations yet" />}
        columns={[
          { key: 'who', header: 'Attendee', cell: (r) => <div className="flex items-center gap-3"><Avatar name={r.user?.full_name} src={photoUrl(r.user?.photo ?? null, 64)} size={32} /><div><p className="font-medium">{r.user?.full_name}</p><p className="text-xs text-ink-muted">{r.email}</p></div></div> },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.status]} className="capitalize">{r.status}</Badge> },
          { key: 'guests', header: 'Guests', hideOnMobile: true, cell: (r) => r.guests || '—' },
          { key: 'note', header: 'Note', hideOnMobile: true, cell: (r) => <span className="text-xs text-ink-muted">{r.note ?? ''}</span> },
          { key: 'in', header: 'Checked in', cell: (r) => r.checked_in_at ? <span className="text-xs text-success">{fmtDateTime(r.checked_in_at)}</span> : '—' },
          { key: 'act', header: <span className="sr-only">Check in</span>, className: 'text-right', cell: (r) => can('events.edit') && ['registered', 'attended'].includes(r.status) && r.user && (
            r.checked_in_at ? <Button size="sm" variant="ghost" onClick={() => check.mutate({ uid: r.user!.id, undo: true })}><Undo2 />Undo</Button>
              : <Button size="sm" variant="outline" onClick={() => check.mutate({ uid: r.user!.id })}><Check />Check in</Button>) },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** QR check-in: camera scanning where the browser supports BarcodeDetector, manual code entry everywhere. */
function CheckIn({ e }: { e: EventT }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const submit = async (value: string) => {
    if (busy.current || !value.trim()) return;
    busy.current = true;
    try {
      const r = await api<{ data: { user: Author | null; guests: number; already_checked_in: boolean } }>(`/api/v1/admin/events/${e.id}/checkin`, { method: 'POST', body: { code: value.trim() } });
      const d = r.data;
      setLast({ ok: !d.already_checked_in, text: `${d.user?.full_name ?? 'Attendee'}${d.guests ? ` +${d.guests}` : ''} — ${d.already_checked_in ? 'already checked in' : 'checked in'}` });
      setCode('');
      qc.invalidateQueries({ queryKey: ['admin-event-regs', e.id] });
      qc.invalidateQueries({ queryKey: ['admin-event', e.id] });
    } catch (err) {
      setLast({ ok: false, text: err instanceof Error ? err.message : 'Not a valid ticket.' });
    } finally { setTimeout(() => { busy.current = false; }, 1500); }
  };
  useEffect(() => {
    if (!camera || !supported) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const det = new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (stop || !video.current) return;
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]) await submit(found[0].rawValue);
          setTimeout(loop, 400);
        };
        loop();
      } catch { setLast({ ok: false, text: 'The camera could not be opened. Enter the code instead.' }); setCamera(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera, supported]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <p className="flex items-center gap-2 font-heading font-semibold text-ink"><QrCode className="h-5 w-5 text-primary" />Scan tickets</p>
        <p className="mt-1 text-sm text-ink-muted">Attendees show the QR code from their ticket page. Scan it, or type the code printed under it.</p>
        {supported && <Button className="mt-4" variant={camera ? 'outline' : 'primary'} onClick={() => setCamera((c) => !c)}><Camera />{camera ? 'Stop camera' : 'Use camera'}</Button>}
        {camera && <video ref={video} className="mt-4 aspect-square w-full max-w-sm rounded-card bg-navy object-cover" muted playsInline />}
        <form className="mt-4 flex gap-2" onSubmit={(x) => { x.preventDefault(); submit(code); }}>
          <Input aria-label="Ticket code" placeholder="Ticket code" value={code} onChange={(x) => setCode(x.target.value)} className="font-mono" />
          <Button type="submit" disabled={!code.trim()}>Check in</Button>
        </form>
        {last && <Alert tone={last.ok ? 'success' : 'warning'} className="mt-4">{last.text}</Alert>}
      </Card>
      <Card className="p-5 text-sm text-ink-muted">
        <p className="font-medium text-ink">Tips</p>
        <ul className="mt-2 list-disc space-y-1 pl-5"><li>Tickets of other events are refused.</li><li>Waitlisted or cancelled registrations cannot be checked in.</li>
          <li>Scanning a ticket twice is safe — it shows “already checked in”.</li><li>Use the Registrations tab to check people in by name.</li></ul>
      </Card>
    </div>
  );
}

function Gallery({ e }: { e: EventT }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const ev = useQuery({ queryKey: ['admin-event', e.id], queryFn: () => get<EventT>(`/api/v1/admin/events/${e.id}`) });
  const del = useAction((mid: string) => api(`/api/v1/admin/events/${e.id}/media/${mid}`, { method: 'DELETE' }), { invalidate: [['admin-event', e.id]] });
  const upload = async (files: FileList | null) => {
    setBusy(true);
    for (const f of Array.from(files ?? [])) {
      const fd = new FormData();
      fd.append('file', f);
      await api(`/api/v1/admin/events/${e.id}/media`, { method: 'POST', body: fd }).catch((x) => toast.error(x instanceof Error ? x.message : 'Upload failed.'));
    }
    setBusy(false);
    ev.refetch();
  };
  return (
    <Card>
      <CardHeader title="Event gallery" icon={ImagePlus} description="Photos appear on the event page for members." action={<Button loading={busy} onClick={() => ref.current?.click()}><Plus />Add photos</Button>} />
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(x) => { upload(x.target.files); x.target.value = ''; }} />
      {!ev.data?.gallery?.length ? <EmptyState icon={ImagePlus} title="No photos yet" /> : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">{ev.data.gallery.map((g) => g && (
          <div key={g.id} className="group relative"><img src={pick(g, 480)} alt="" className="aspect-[4/3] w-full rounded-btn object-cover" />
            <button onClick={() => del.mutate(g.id)} aria-label="Remove photo" className="absolute right-1 top-1 rounded-full bg-navy/80 p-1 text-white opacity-0 transition group-hover:opacity-100"><X className="h-4 w-4" /></button></div>))}</div>
      )}
    </Card>
  );
}

function EventFeedbackList({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin-event-feedback', id], queryFn: () => get<{ user: Author | null; rating: number; comment: string | null; created_at: string }[]>(`/api/v1/admin/events/${id}/feedback`) });
  if (!q.data?.length) return <Card><EmptyState icon={Star} title="No feedback yet" description="Attendees can rate the event once it has started." /></Card>;
  return <Card><ul className="divide-y divide-line">{q.data.map((f, i) => <li key={i} className="px-5 py-3"><Stars value={f.rating} /><p className="mt-1 text-sm text-ink">{f.comment}</p><p className="text-xs text-ink-muted">{f.user?.full_name} · {fmtDate(f.created_at)}</p></li>)}</ul></Card>;
}

// ── jobs ────────────────────────────────────────────────────────────────────
export function JobsAdminPage() {
  const { tab = 'jobs' } = useParams();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Jobs & Internships" description="Review postings, employers, categories and career resources." />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'jobs' ? '/admin/jobs' : `/admin/jobs/${v}`)}
        tabs={[{ value: 'jobs', label: 'Job postings' }, { value: 'employers', label: 'Employers' }, { value: 'categories', label: 'Categories' }, { value: 'resources', label: 'Career resources' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'employers' ? <Employers /> : tab === 'categories' ? <Categories /> : tab === 'resources' ? <ResourcesAdmin /> : <JobQueue />}</div>
    </>
  );
}

function JobQueue() {
  const { can } = useAuth();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Job | null>(null);
  const [rejecting, setRejecting] = useState<Job | null>(null);
  const dq = useDebounced(q);
  const params = { status, q: dq, page };
  const list = useQuery({ queryKey: ['admin-jobs', params], queryFn: () => api<Paged<Job> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/jobs${qs(params)}`), placeholderData: keepPreviousData });
  const approve = useAction((j: Job) => api(`/api/v1/admin/jobs/${j.id}/approve`, { method: 'POST' }), { success: 'Job approved and listed.', invalidate: [['admin-jobs']], onSuccess: () => setOpen(null) });
  const counts = list.data?.meta.counts ?? {};
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-4">{(['pending', 'approved', 'rejected', 'closed'] as const).map((s) => (
        <button key={s} className="text-left" onClick={() => { setStatus(s); setPage(1); }} aria-pressed={status === s}>
          <StatTile icon={Briefcase} tone={s === 'pending' ? 'warning' : s === 'approved' ? 'success' : 'navy'} value={counts[s] ?? 0} label={`${s[0]!.toUpperCase()}${s.slice(1)}${status === s ? ' · showing' : ''}`} /></button>))}</div>
      <Card>
        <div className="flex gap-3 border-b border-line p-4"><Input aria-label="Search" placeholder="Search title or organisation…" value={q} onChange={(x) => { setQ(x.target.value); setPage(1); }} className="max-w-sm" />
          {can('jobs.export') && <Button variant="outline" className="ml-auto" onClick={() => download('/api/v1/admin/jobs/export', 'jobs.csv')}><Download />Export</Button>}</div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(j) => j.id} empty={<EmptyState icon={Briefcase} title={status === 'pending' ? 'Nothing waiting for review' : 'No jobs'} />}
          columns={[
            { key: 'job', header: 'Job', cell: (j) => <button className="text-left" onClick={() => setOpen(j)}><p className="font-medium text-primary hover:underline">{j.title}</p><p className="text-xs text-ink-muted">{j.organization} · {j.location}</p></button> },
            { key: 'type', header: 'Type', cell: (j) => TYPE_LABEL[j.employment_type] },
            { key: 'by', header: 'Posted by', hideOnMobile: true, cell: (j) => <span className="text-sm">{j.posted_by?.full_name ?? '—'}{j.employer?.verified && <Badge tone="success" className="ml-1">Employer</Badge>}</span> },
            { key: 'apps', header: 'Applications', hideOnMobile: true, cell: (j) => j.application_count ?? 0 },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (j) => j.status === 'pending' && (
              <div className="flex justify-end gap-1">{can('jobs.approve') && <Button size="sm" onClick={() => approve.mutate(j)}><Check />Approve</Button>}
                {can('jobs.reject') && <Button size="sm" variant="ghost" onClick={() => setRejecting(j)}><X />Reject</Button>}</div>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {open && (
        <Dialog open onOpenChange={(v) => !v && setOpen(null)} wide title={open.title} description={`${open.organization} · ${open.location} · ${TYPE_LABEL[open.employment_type]}`}
          footer={open.status === 'pending' && <>{can('jobs.reject') && <Button variant="outline" onClick={() => { setRejecting(open); setOpen(null); }}>Reject</Button>}{can('jobs.approve') && <Button onClick={() => approve.mutate(open)}><Check />Approve</Button>}</>}>
          <p className="whitespace-pre-line text-sm text-ink">{open.description}</p>
          <p className="mt-3 text-xs text-ink-muted">{[open.experience, open.skills.join(', '), open.deadline && `Deadline ${fmtDate(open.deadline)}`].filter(Boolean).join(' · ')}</p>
        </Dialog>
      )}
      {rejecting && <ReasonDialog title={`Reject ${rejecting.title}`} url={`/api/v1/admin/jobs/${rejecting.id}/reject`} invalidate={[['admin-jobs']]} onClose={() => setRejecting(null)} />}
    </>
  );
}

function ReasonDialog({ title, url, body, invalidate, onClose }: { title: string; url: string; body?: Record<string, unknown>; invalidate: string[][]; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const run = useAction(() => api(url, { method: 'POST', body: { ...body, reason } }), { success: 'Done — the member was emailed.', invalidate, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={title} description="The reason is sent so it can be corrected."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={run.isPending} onClick={() => run.mutate(undefined)}>Reject</Button></>}>
      <Textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
    </Dialog>
  );
}

function Employers() {
  const { can } = useAuth();
  const [status, setStatus] = useState('pending');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-employers', status], queryFn: () => get<{ id: string; name: string; website: string | null; industry: string | null; description: string; status: string; owner: Author | null; created_at: string }[]>(`/api/v1/admin/jobs/employers?status=${status}`) });
  const approve = useAction((id: string) => api(`/api/v1/admin/jobs/employers/${id}/decide`, { method: 'POST', body: { approve: true } }), { success: 'Employer approved.', invalidate: [['admin-employers']] });
  return (
    <Card>
      <div className="border-b border-line p-4"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select></div>
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(e) => e.id} empty={<EmptyState icon={Building2} title="No employers here" />}
        columns={[
          { key: 'name', header: 'Organisation', cell: (e) => <div className="max-w-sm"><p className="font-medium">{e.name}</p><p className="line-clamp-2 text-xs text-ink-muted">{[e.industry, e.website].filter(Boolean).join(' · ')}</p></div> },
          { key: 'owner', header: 'Registered by', cell: (e) => e.owner?.full_name ?? '—' },
          { key: 'when', header: 'Date', hideOnMobile: true, cell: (e) => fmtDate(e.created_at) },
          { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (e) => e.status === 'pending' && can('jobs.approve') && (
            <div className="flex justify-end gap-1"><Button size="sm" onClick={() => approve.mutate(e.id)}><Check />Approve</Button><Button size="sm" variant="ghost" onClick={() => setRejecting(e.id)}><X />Reject</Button></div>) },
        ]} />
      {rejecting && <ReasonDialog title="Reject employer" url={`/api/v1/admin/jobs/employers/${rejecting}/decide`} body={{ approve: false }} invalidate={[['admin-employers']]} onClose={() => setRejecting(null)} />}
    </Card>
  );
}

function Categories() {
  const [name, setName] = useState('');
  const list = useQuery({ queryKey: ['job-categories'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/jobs/categories') });
  const add = useAction(() => api('/api/v1/admin/jobs/categories', { method: 'POST', body: { name } }), { success: 'Category added.', invalidate: [['job-categories']], onSuccess: () => setName('') });
  const del = useAction((id: string) => api(`/api/v1/admin/jobs/categories/${id}`, { method: 'DELETE' }), { invalidate: [['job-categories']] });
  return (
    <Card className="max-w-xl">
      <form className="flex gap-2 border-b border-line p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}><Input aria-label="New category" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} /><Button type="submit" disabled={name.trim().length < 2}><Plus />Add</Button></form>
      <ul className="divide-y divide-line">{list.data?.map((c) => <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">{c.name}<Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => del.mutate(c.id)}><Trash2 /></Button></li>)}</ul>
    </Card>
  );
}

function ResourcesAdmin() {
  type R = { id: string; title: string; category: string; description: string; url: string | null; published: boolean; position: number };
  const list = useQuery({ queryKey: ['admin-resources'], queryFn: () => get<R[]>('/api/v1/admin/jobs/resources') });
  const [editing, setEditing] = useState<R | 'new' | null>(null);
  const del = useAction((id: string) => api(`/api/v1/admin/jobs/resources/${id}`, { method: 'DELETE' }), { invalidate: [['admin-resources']] });
  return (
    <Card>
      <CardHeader title="Career resources" description="Guides and links shown to members in Jobs → Career resources." action={<Button size="sm" onClick={() => setEditing('new')}><Plus />Add</Button>} />
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(r) => r.id} empty={<EmptyState icon={Briefcase} title="No resources yet" />}
        columns={[
          { key: 't', header: 'Title', cell: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-ink-muted">{r.url}</p></div> },
          { key: 'c', header: 'Category', cell: (r) => r.category },
          { key: 'p', header: 'Published', cell: (r) => r.published ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge> },
          { key: 'a', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(r)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label="Delete" onClick={() => del.mutate(r.id)}><Trash2 /></Button></div> },
        ]} />
      {editing && <ResourceDialog r={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ResourceDialog({ r, onClose }: { r: { id: string; title: string; category: string; description: string; url: string | null; published: boolean; position: number } | null; onClose: () => void }) {
  const [f, setF] = useState({ title: r?.title ?? '', category: r?.category ?? 'General', description: r?.description ?? '', url: r?.url ?? '', published: r?.published ?? true, position: r?.position ?? 0 });
  const save = useAction(() => api(r ? `/api/v1/admin/jobs/resources/${r.id}` : '/api/v1/admin/jobs/resources', { method: r ? 'PUT' : 'POST', body: { ...f, url: f.url || null } }), { success: 'Saved.', invalidate: [['admin-resources']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={r ? 'Edit resource' : 'Add resource'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Title" required error={save.fieldErrors.title}>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Category">{(id) => <Input id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
        <Field label="Link" required error={save.fieldErrors.url}>{(id) => <Input id={id} value={f.url} placeholder="https://…" onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[70px]" />}</Field>
        <Switch checked={f.published} onCheckedChange={(v) => setF({ ...f, published: v })} label="Published" />
      </div>
    </Dialog>
  );
}

// ── mentorship ──────────────────────────────────────────────────────────────
export function MentorshipAdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('applications');
  const [status, setStatus] = useState('pending');
  const [open, setOpen] = useState<MentorT | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const mentors = useQuery({ queryKey: ['admin-mentors', status], queryFn: () => api<Paged<MentorT> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/mentorship/mentors?status=${status}`), enabled: tab === 'applications' });
  const reqs = useQuery({ queryKey: ['admin-mentorships'], queryFn: () => api<{ data: { id: string; mentor: Author | null; mentee: Author | null; topic: string; status: string; created_at: string }[]; meta: { counts: Record<string, number>; sessions: Record<string, number>; average_rating: number | null } }>('/api/v1/admin/mentorship/requests?page_size=50') });
  const approve = useAction((uid: string) => api(`/api/v1/admin/mentorship/mentors/${uid}/decide`, { method: 'POST', body: { approve: true } }), { success: 'Mentor approved.', invalidate: [['admin-mentors']], onSuccess: () => setOpen(null) });
  const m = reqs.data?.meta;
  return (
    <>
      <PageHeader title="Mentorship Management" description="Mentor applications and mentorship activity." actions={can('mentorship.export') && <Button variant="outline" onClick={() => download('/api/v1/admin/mentorship/export', 'mentorships.csv')}><Download />Export</Button>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <StatTile icon={UsersRound} value={mentors.data?.meta.counts?.approved ?? '…'} label="Active mentors" />
        <StatTile icon={Users} tone="warning" value={m?.counts.pending ?? 0} label="Requests waiting" />
        <StatTile icon={Check} tone="success" value={(m?.counts.accepted ?? 0) + (m?.counts.completed ?? 0)} label="Mentorships" />
        <StatTile icon={Star} tone="navy" value={m?.average_rating ?? '—'} label={`Sessions held: ${m?.sessions.completed ?? 0}`} />
      </div>
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'applications', label: 'Mentors' }, { value: 'activity', label: 'Mentorships' }]}><span /></Tabs>
      <div className="mt-5">
        {tab === 'applications' ? (
          <Card>
            <div className="border-b border-line p-4"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
              {['pending', 'approved', 'paused', 'rejected'].map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)} ({mentors.data?.meta.counts?.[s] ?? 0})</option>)}</Select></div>
            <DataTable rows={mentors.data?.data} loading={mentors.isLoading} rowKey={(x) => x.user.id} empty={<EmptyState icon={UsersRound} title="Nothing here" />}
              columns={[
                { key: 'who', header: 'Mentor', cell: (x) => <button className="flex items-center gap-3 text-left" onClick={() => setOpen(x)}><Avatar name={x.user.full_name} src={photoUrl(x.user.photo, 64)} size={34} /><span><span className="block font-medium text-primary hover:underline">{x.user.full_name}</span><span className="text-xs text-ink-muted">{x.industry}</span></span></button> },
                { key: 'exp', header: 'Expertise', hideOnMobile: true, cell: (x) => <span className="text-xs">{x.expertise.join(', ')}</span> },
                { key: 'load', header: 'Mentees', cell: (x) => `${x.active_mentees} / ${x.max_mentees}` },
                { key: 'rating', header: 'Rating', hideOnMobile: true, cell: (x) => <Stars value={x.rating} /> },
                { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (x) => x.status === 'pending' && can('mentorship.approve') && (
                  <div className="flex justify-end gap-1"><Button size="sm" onClick={() => approve.mutate(x.user.id)}><Check />Approve</Button><Button size="sm" variant="ghost" onClick={() => setRejecting(x.user.id)}><X />Reject</Button></div>) },
              ]} />
          </Card>
        ) : (
          <Card>
            <DataTable rows={reqs.data?.data} loading={reqs.isLoading} rowKey={(r) => r.id} empty={<EmptyState icon={Users} title="No mentorships yet" />}
              columns={[
                { key: 't', header: 'Topic', cell: (r) => r.topic },
                { key: 'm', header: 'Mentor', cell: (r) => r.mentor?.full_name ?? '—' },
                { key: 'e', header: 'Mentee', cell: (r) => r.mentee?.full_name ?? '—' },
                { key: 's', header: 'Status', cell: (r) => <Badge className="capitalize">{r.status}</Badge> },
                { key: 'd', header: 'Requested', hideOnMobile: true, cell: (r) => fmtDate(r.created_at) },
              ]} />
          </Card>
        )}
      </div>
      {open && (
        <Dialog open onOpenChange={(v) => !v && setOpen(null)} wide title={open.user.full_name} description={[open.industry, open.experience_years ? `${open.experience_years} years` : null].filter(Boolean).join(' · ')}
          footer={open.status === 'pending' && can('mentorship.approve') && <><Button variant="outline" onClick={() => { setRejecting(open.user.id); setOpen(null); }}>Reject</Button><Button onClick={() => approve.mutate(open.user.id)}>Approve</Button></>}>
          <p className="whitespace-pre-line text-sm text-ink">{open.introduction}</p>
          <p className="mt-3 text-sm"><strong>Expertise:</strong> {open.expertise.join(', ')}</p>
          <p className="text-sm"><strong>Formats:</strong> {open.formats.join(', ')} · {open.hours_per_month} h/month · up to {open.max_mentees} mentees</p>
        </Dialog>
      )}
      {rejecting && <ReasonDialog title="Reject mentor application" url={`/api/v1/admin/mentorship/mentors/${rejecting}/decide`} body={{ approve: false }} invalidate={[['admin-mentors']]} onClose={() => setRejecting(null)} />}
    </>
  );
}

// ── achievements ────────────────────────────────────────────────────────────
export function AchievementsAdminPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('nominated');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<(AchievementT & { user_id?: string; image_id?: string | null; nomination_reason?: string | null; nominated_by?: Author | null }) | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-achievements', status, page], queryFn: () => api<Paged<AchievementT & { user_id: string; image_id: string | null; nomination_reason: string | null; nominated_by: Author | null }> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/achievements${qs({ status, page })}`), placeholderData: keepPreviousData });
  const review = useAction(({ id, action }: { id: string; action: string }) => api(`/api/v1/admin/achievements/${id}/review`, { method: 'POST', body: { action } }), { success: 'Done.', invalidate: [['admin-achievements']] });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const counts = list.data?.meta.counts ?? {};
  return (
    <>
      <PageHeader title="Alumni Achievements" description="Review nominations, write stories and feature alumni." actions={can('achievements.create') && <Button onClick={() => setEditing('new')}><Plus />Add achievement</Button>} />
      <Card>
        <div className="border-b border-line px-4 pt-2"><Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}
          tabs={['nominated', 'approved', 'published', 'rejected'].map((s) => ({ value: s, label: `${s[0]!.toUpperCase()}${s.slice(1)} (${counts[s] ?? 0})` }))}><span /></Tabs></div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(a) => a.id} empty={<EmptyState icon={Medal} title="Nothing here" />}
          columns={[
            { key: 'a', header: 'Achievement', cell: (a) => <div className="max-w-sm"><p className="font-medium">{a.title}</p><p className="text-xs text-ink-muted">{a.kind_label} · {a.person?.full_name}</p>
              {a.nomination_reason && <p className="mt-1 line-clamp-2 text-xs text-ink">“{a.nomination_reason}” — {a.nominated_by?.full_name}</p>}</div> },
            { key: 'c', header: 'Public site', hideOnMobile: true, cell: (a) => a.public_consent ? <Badge tone="success">Consented</Badge> : a.status === 'published' ? <Badge>Portal only</Badge> : '—' },
            { key: 'f', header: 'Featured', hideOnMobile: true, cell: (a) => a.featured ? <Star className="h-4 w-4 fill-warning text-warning" /> : '' },
            { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (a) => (
              <div className="flex flex-wrap justify-end gap-1">
                {can('achievements.edit') && <Button size="sm" variant="outline" onClick={() => setEditing(a)}><Pencil />Edit</Button>}
                {a.status === 'nominated' && can('achievements.approve') && <Button size="sm" variant="outline" onClick={() => review.mutate({ id: a.id, action: 'approve' })}><Check />Approve</Button>}
                {['nominated', 'approved'].includes(a.status ?? '') && can('achievements.publish') && <Button size="sm" onClick={() => review.mutate({ id: a.id, action: 'publish' })}><Eye />Publish</Button>}
                {a.status === 'published' && can('achievements.publish') && <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: a.id, action: 'unpublish' })}>Unpublish</Button>}
                {a.status === 'nominated' && can('achievements.reject') && <Button size="sm" variant="ghost" onClick={() => setRejecting(a.id)}><X /></Button>}
              </div>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {editing && <AchievementDialog a={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {rejecting && <ReasonDialog title="Reject nomination" url={`/api/v1/admin/achievements/${rejecting}/review`} body={{ action: 'reject' }} invalidate={[['admin-achievements']]} onClose={() => setRejecting(null)} />}
    </>
  );
}

function AchievementDialog({ a, onClose }: { a: (AchievementT & { user_id?: string; image_id?: string | null }) | null; onClose: () => void }) {
  const toast = useToast();
  const [person, setPerson] = useState<{ id: string; name: string } | null>(a?.user_id ? { id: a.user_id, name: a.person?.full_name ?? '' } : null);
  const [search, setSearch] = useState('');
  const ds = useDebounced(search);
  const found = useQuery({ queryKey: ['admin-alumni-pick', ds], queryFn: () => api<Paged<PersonCard & { full_name: string }>>(`/api/v1/admin/alumni?q=${encodeURIComponent(ds)}&status=verified&page_size=8`), enabled: ds.length >= 2 && !person });
  const [f, setF] = useState({ kind: a?.kind ?? 'success_story', title: a?.title ?? '', summary: a?.summary ?? '', story: a?.story ?? '', image_id: a?.image_id ?? null as string | null,
    year: a?.year ? String(a.year) : '', month: a?.month ? String(a.month) : '', featured: a?.featured ?? false });
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useAction(() => api(a ? `/api/v1/admin/achievements/${a.id}` : '/api/v1/admin/achievements', { method: a ? 'PUT' : 'POST', body: {
    ...f, user_id: person?.id, year: f.year ? Number(f.year) : null, month: f.month ? Number(f.month) : null } }), { success: 'Saved.', invalidate: [['admin-achievements']], onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={a ? 'Edit achievement' : 'Add achievement'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!person} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Alumnus" required className="sm:col-span-2">{(id) => person ? <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2 text-sm">{person.name}<Button size="sm" variant="ghost" onClick={() => setPerson(null)}>Change</Button></div> : (<>
          <Input id={id} placeholder="Search verified alumni…" value={search} onChange={(x) => setSearch(x.target.value)} />
          {found.data && <ul className="mt-1 max-h-40 divide-y divide-line overflow-y-auto rounded-btn border border-line">{found.data.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-canvas" onClick={() => setPerson({ id: p.id, name: p.full_name })}>{p.full_name}</button></li>)}</ul>}</>)}</Field>
        <Field label="Category">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{ACH_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Year" error={e.year}>{(id) => <Input id={id} type="number" value={f.year} onChange={(x) => setF({ ...f, year: x.target.value })} />}</Field>
          <Field label="Month" error={e.month}>{(id) => <Input id={id} type="number" min={1} max={12} value={f.month} onChange={(x) => setF({ ...f, month: x.target.value })} />}</Field>
        </div>
        <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <Field label="Summary" className="sm:col-span-2">{(id) => <Input id={id} value={f.summary} maxLength={500} onChange={(x) => setF({ ...f, summary: x.target.value })} />}</Field>
        <Field label="Story" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.story} maxLength={20000} onChange={(x) => setF({ ...f, story: x.target.value })} className="min-h-[160px]" />}</Field>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus />{f.image_id ? 'Change image' : 'Add image'}</Button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (x) => { const file = x.target.files?.[0]; x.target.value = ''; if (!file) return;
            try { setF({ ...f, image_id: await uploadImage(file) }); toast.success('Image uploaded.'); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed.'); } }} /></div>
        <Checkbox checked={f.featured} onCheckedChange={(v) => setF({ ...f, featured: v })} label="Featured" />
      </div>
    </Dialog>
  );
}

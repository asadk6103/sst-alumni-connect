import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, Globe, Medal, Plus, Search, Trophy } from 'lucide-react';
import { api, ApiError, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl, type PersonCard } from '@/lib/alumni';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { RichText, type Author } from '@/components/community';
import { pick, type Img } from './Events';

export type AchievementT = { id: string; kind: string; kind_label: string; title: string; summary: string; story: string; image: Img; year: number | null;
  month: number | null; featured: boolean; person: Author | null; published_at: string | null; status?: string; public_consent?: boolean | null;
  about_me?: boolean; rejection_reason?: string | null };
export const ACH_KINDS: [string, string][] = [['distinguished', 'Distinguished alumni'], ['alumni_of_month', 'Alumni of the month'],
  ['success_story', 'Success stories'], ['award', 'Awards'], ['milestone', 'Professional milestones']];

export function AchievementCard({ a }: { a: AchievementT }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={`/portal/achievements/${a.id}`} className="relative block aspect-[16/9] bg-gradient-to-br from-primary to-navy">
        {a.image ? <img src={pick(a.image, 800)} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <span className="grid h-full place-items-center"><Avatar name={a.person?.full_name} src={photoUrl(a.person?.photo ?? null, 200)} size={96} /></span>}
        <span className="absolute left-3 top-3"><Badge tone="navy"><Medal className="h-3 w-3" />{a.kind_label}</Badge></span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link to={`/portal/achievements/${a.id}`} className="font-heading font-semibold leading-snug text-ink hover:text-primary">{a.title}</Link>
        <p className="mt-1 text-sm text-ink-muted">{a.person?.full_name}{a.person?.batch ? ` · ${a.person.batch}` : ''}</p>
        {a.summary && <p className="mt-2 line-clamp-3 text-sm text-ink">{a.summary}</p>}
      </div>
    </Card>
  );
}

export function AchievementsPage() {
  const { can } = useAuth();
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('published');
  const [nominating, setNominating] = useState(false);
  const dq = useDebounced(q);
  const params = { kind, q: dq, page, page_size: 12 };
  const list = useQuery({ queryKey: ['achievements', params], queryFn: () => api<Paged<AchievementT>>(`/api/v1/achievements${qs(params)}`), placeholderData: keepPreviousData, enabled: tab === 'published' });
  return (
    <>
      <PageHeader title="Alumni Achievements" description="Celebrating distinguished alumni, success stories and milestones."
        actions={can('portal.nominate') && <Button onClick={() => setNominating(true)}><Plus />Nominate an alumnus</Button>} />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'published', label: 'Achievements' }, { value: 'mine', label: 'My nominations' }]}><span /></Tabs>
      <div className="mt-5">
        {tab === 'mine' ? <MyNominations /> : (
          <>
            <Card className="mb-5 flex flex-col gap-3 p-3 sm:flex-row">
              <Select aria-label="Category" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="sm:w-56"><option value="">All categories</option>{ACH_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <Input aria-label="Search achievements" placeholder="Search by name or title…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
            </Card>
            {list.isLoading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-card" />)}</div>
              : !list.data?.data.length ? <Card><EmptyState icon={Trophy} title="No achievements yet" description="Know an alumnus whose story should be told? Nominate them." /></Card>
              : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.data.data.map((a) => <AchievementCard key={a.id} a={a} />)}</div>}
            {list.data && list.data.meta.pages > 1 && <Card className="mt-5"><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
          </>
        )}
      </div>
      {nominating && <NominateDialog onClose={() => setNominating(false)} />}
    </>
  );
}

function MyNominations() {
  const q = useQuery({ queryKey: ['my-nominations'], queryFn: () => get<AchievementT[]>('/api/v1/achievements/nominations/mine') });
  const consent = useAction(({ id, pub }: { id: string; pub: boolean }) => api(`/api/v1/achievements/${id}/consent`, { method: 'POST', body: { public: pub } }), { success: 'Saved.', invalidate: [['my-nominations']] });
  const TONE: Record<string, 'warning' | 'primary' | 'success' | 'danger'> = { nominated: 'warning', approved: 'primary', published: 'success', rejected: 'danger' };
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!q.data?.length) return <Card><EmptyState icon={Award} title="Nothing here yet" description="Nominations you make — and achievements about you — appear here." /></Card>;
  return (
    <Card><ul className="divide-y divide-line">{q.data.map((a) => (
      <li key={a.id} className="space-y-2 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{a.title}</span><Badge tone={TONE[a.status ?? 'nominated']} className="capitalize">{a.status}</Badge>
          <span className="text-xs text-ink-muted">{a.kind_label} · {a.about_me ? 'about you' : a.person?.full_name}</span></div>
        {a.rejection_reason && <p className="text-xs text-danger">{a.rejection_reason}</p>}
        {a.about_me && a.status === 'published' && (
          <Switch checked={!!a.public_consent} onCheckedChange={(v) => consent.mutate({ id: a.id, pub: v })} label="Show on the public website"
            description="Your name, photo and batch appear with the story on the school's public alumni pages." />
        )}
      </li>))}</ul></Card>
  );
}

function NominateDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null);
  const [f, setF] = useState({ kind: 'success_story', title: '', reason: '', year: '' });
  const ds = useDebounced(search);
  const people = useQuery({ queryKey: ['nominee-search', ds], queryFn: () => api<Paged<PersonCard>>(`/api/v1/alumni/directory?q=${encodeURIComponent(ds)}&page_size=8`), enabled: ds.length >= 2 && !person });
  const send = useAction(() => api('/api/v1/achievements/nominations', { method: 'POST', body: { user_id: person!.id, kind: f.kind, title: f.title, reason: f.reason, year: f.year ? Number(f.year) : null } }),
    { success: 'Thank you! The alumni office will review your nomination.', invalidate: [['my-nominations']], onSuccess: onClose });
  const e = send.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Nominate an alumnus" description="Nominations are reviewed by the alumni office before anything is published."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={send.isPending} disabled={!person || f.title.length < 5 || f.reason.length < 30} onClick={() => send.mutate(undefined)}>Send nomination</Button></>}>
      <div className="space-y-4">
        <Field label="Who?" required error={e.user_id}>{(id) => person ? (
          <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2"><span className="text-sm text-ink">{person.full_name}</span><Button size="sm" variant="ghost" onClick={() => setPerson(null)}>Change</Button></div>
        ) : (<>
          <div className="flex gap-2"><Input id={id} placeholder="Search alumni by name…" value={search} onChange={(x) => setSearch(x.target.value)} />
            {user && <Button variant="outline" onClick={() => setPerson({ id: user.id, full_name: `${user.full_name} (myself)` })}>Myself</Button>}</div>
          {people.data && <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto rounded-btn border border-line">{people.data.data.map((p) => (
            <li key={p.id}><button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas" onClick={() => setPerson({ id: p.id, full_name: p.full_name })}>
              <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={28} />{p.full_name}<span className="text-xs text-ink-muted">{p.batch}</span></button></li>))}</ul>}
        </>)}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{ACH_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Year (optional)">{(id) => <Input id={id} type="number" min={1950} max={2100} value={f.year} onChange={(x) => setF({ ...f, year: x.target.value })} />}</Field>
        </div>
        <Field label="Title" required hint="e.g. From SST to Head of Research at NUST" error={e.title}>{(id, d) => <Input id={id} aria-describedby={d} value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <Field label="Why should they be recognised?" required hint="At least 30 characters." error={e.reason}>{(id, d) => <Textarea id={id} aria-describedby={d} value={f.reason} maxLength={2000} onChange={(x) => setF({ ...f, reason: x.target.value })} className="min-h-[120px]" />}</Field>
      </div>
    </Dialog>
  );
}

export function AchievementPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['achievement', id], queryFn: () => get<AchievementT>(`/api/v1/achievements/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const a = q.data;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/portal/achievements" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Achievements</Link>
      {q.isLoading ? <Skeleton className="h-96 rounded-card" /> : !a ? <Card><EmptyState icon={Trophy} title="Not found" /></Card> : (
        <Card className="overflow-hidden">
          {a.image && <img src={pick(a.image, 1200)} alt="" className="aspect-[16/7] w-full object-cover" />}
          <div className="p-6">
            <Badge tone="primary"><Medal className="h-3 w-3" />{a.kind_label}{a.year ? ` · ${a.month ? `${new Date(2000, a.month - 1).toLocaleString(undefined, { month: 'long' })} ` : ''}${a.year}` : ''}</Badge>
            <h1 className="mt-3 font-heading text-2xl font-semibold text-ink">{a.title}</h1>
            {a.person && <Link to={`/portal/alumni/${a.person.id}`} className="mt-3 flex items-center gap-3"><Avatar name={a.person.full_name} src={photoUrl(a.person.photo, 96)} size={44} />
              <span><span className="block font-medium text-ink">{a.person.full_name}</span><span className="text-xs text-ink-muted">{a.person.batch}</span></span></Link>}
            {a.summary && <p className="mt-5 text-lg text-ink">{a.summary}</p>}
            {a.story && <div className="mt-4"><RichText text={a.story} /></div>}
            {a.published_at && <p className="mt-6 flex items-center gap-1 text-xs text-ink-muted"><Globe className="h-3.5 w-3.5" />Published {fmtDate(a.published_at)}</p>}
            {a.status && a.status !== 'published' && <Alert tone="info" className="mt-4">This achievement is not published yet.</Alert>}
          </div>
        </Card>
      )}
    </div>
  );
}


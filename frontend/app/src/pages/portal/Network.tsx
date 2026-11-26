import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, BarChart3, Building2, Filter, GraduationCap, LayoutGrid, List, Mail, MapPin, Search, Share2, Upload, UserPlus, Users, UsersRound, X,
} from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { SectionCard, type GroupT } from '@/components/community';
import { MiniPerson, PersonGridCard, PersonRow, PresenceAvatar, StatTile, usePersonActions, type Person } from '@/components/people';
import { InviteDialog, PortalPage } from '@/layouts/PortalLayout';
import { classLabel } from '@/lib/alumni';
import { VerifiedBadge } from '@/components/alumni';

type Summary = {
  me: { graduation_year: number | null; city: string | null; industry: string | null };
  tabs: { all: number; suggestions: number; same_batch: number; same_city: number; same_industry: number };
  network: { connections: number; mutual: number; batches: number; groups: number; followers: number; following: number; received: number; sent: number; suggestions: number };
  by_batch: { year: number; count: number }[];
  common_groups: GroupT[];
};
type ConnPage = Paged<Person> & { meta: { counts: { received: number; connected: number } } };

const useSummary = () => useQuery({ queryKey: ['network-summary'], queryFn: () => get<Summary>('/api/v1/alumni/network/summary') });
const useSuggestions = (limit = 24) => useQuery({ queryKey: ['suggestions', limit], queryFn: () => get<Person[]>(`/api/v1/alumni/suggestions?limit=${limit}`) });

function Header({ title, subtitle, crumb, action }: { title: string; subtitle: string; crumb?: [string, string]; action?: React.ReactNode }) {
  return (
    <div>
      {crumb && <p className="mb-1 text-sm text-ink-muted"><Link to={crumb[1]} className="hover:text-ink">{crumb[0]}</Link> <span aria-hidden>›</span> {title}</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">{title}</h1><p className="mt-1 text-ink-muted">{subtitle}</p></div>
        {action}
      </div>
    </div>
  );
}

function TabBar({ tabs, value, onChange }: { tabs: { k: string; l: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => <button key={t.k} role="tab" aria-selected={value === t.k} onClick={() => onChange(t.k)}
        className={cn('shrink-0 border-b-[3px] px-4 py-3 text-[15px] font-medium', value === t.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>{t.l}</button>)}
    </div>
  );
}

// ── My Network ──────────────────────────────────────────────────────────────
export function MyNetworkPage() {
  const { tab = 'overview' } = useParams();
  const nav = useNavigate();
  const s = useSummary();
  const n = s.data?.network;
  const tabs = [{ k: 'overview', l: 'Overview' }, { k: 'connections', l: `Connections${n ? ` (${n.connections})` : ''}` }, { k: 'requests', l: `Requests${n ? ` (${n.received})` : ''}` },
    { k: 'suggestions', l: 'Suggestions' }, { k: 'following', l: 'Following' }, { k: 'followers', l: 'Followers' }];
  return (
    <PortalPage aside={<NetworkAside summary={s.data} />}>
      <Header title="My Network" subtitle="Build, manage and grow your alumni connections."
        action={<Button onClick={() => nav('/portal/network/find')}><UserPlus />Find Alumni</Button>} />
      <TabBar tabs={tabs} value={tab} onChange={(k) => nav(k === 'overview' ? '/portal/network' : `/portal/network/${k}`)} />
      {tab === 'overview' && <Overview summary={s.data} />}
      {tab === 'connections' && <ConnectionTable type="connected" title="Your Connections" />}
      {tab === 'requests' && <><Requests /><ConnectionTable type="sent" title="Sent requests" /></>}
      {tab === 'suggestions' && <SuggestionGrid />}
      {tab === 'following' && <ConnectionTable type="following" title="People you follow" />}
      {tab === 'followers' && <ConnectionTable type="followers" title="Your followers" />}
    </PortalPage>
  );
}

function Overview({ summary }: { summary?: Summary }) {
  const n = summary?.network;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={Users} value={n?.connections ?? '–'} label="Connections" />
        <StatTile icon={UsersRound} value={n?.mutual ?? '–'} label="Mutual Connections" tone="success" />
        <StatTile icon={Building2} value={n?.batches ?? '–'} label="Batches" tone="info" />
        <StatTile icon={Share2} value={n?.groups ?? '–'} label="Groups in Common" tone="warning" />
      </div>
      <Requests compact />
      <ConnectionTable type="connected" title="Your Connections" pageSize={5} />
    </>
  );
}

function Requests({ compact }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ['connections', 'received'], queryFn: () => api<ConnPage>('/api/v1/alumni/connections?type=received&page_size=20') });
  const rows = q.data?.data ?? [];
  if (compact && !rows.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-ink"><UserPlus className="h-5 w-5 text-primary" />Connection Requests ({q.data?.meta.total ?? 0})</h2>
        {compact && <Link to="/portal/network/requests" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View All Requests<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>}
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : !rows.length ? <p className="text-sm text-ink-muted">No pending requests.</p> : (
        <div className={cn('grid gap-3', compact ? 'grid-flow-col auto-cols-[minmax(170px,1fr)] overflow-x-auto pb-1' : 'sm:grid-cols-2 lg:grid-cols-3')}>
          {(compact ? rows.slice(0, 5) : rows).map((p) => <RequestCard key={p.id} p={p} />)}
        </div>
      )}
    </Card>
  );
}

function RequestCard({ p }: { p: Person }) {
  const a = usePersonActions(p);
  return (
    <div className="rounded-card border border-line p-4 text-center">
      <Link to={`/portal/alumni/${p.id}`} className="inline-block"><PresenceAvatar p={{ ...p, online: undefined }} size={64} /></Link>
      <Link to={`/portal/alumni/${p.id}`} className="mt-2 block truncate font-semibold text-ink hover:text-primary">{p.full_name}</Link>
      <p className="text-sm text-ink-muted">{classLabel(p)}</p>
      <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-ink-muted"><Users className="h-3.5 w-3.5" />{p.mutual ?? 0} mutual connections</p>
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" loading={a.respond.isPending && a.respond.variables === 'accept'} onClick={() => a.respond.mutate('accept')}>Accept</Button>
        <Button size="sm" variant="outline" loading={a.respond.isPending && a.respond.variables === 'decline'} onClick={() => a.respond.mutate('decline')}><X />Decline</Button>
      </div>
    </div>
  );
}

function ConnectionTable({ type, title, pageSize = 20 }: { type: 'connected' | 'sent' | 'following' | 'followers'; title: string; pageSize?: number }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['connections', type, dq, page, pageSize], queryFn: () => api<ConnPage>(`/api/v1/alumni/connections${qs({ type, q: dq || null, page, page_size: pageSize })}`) });
  const rows = list.data?.data ?? [];
  if (type === 'sent' && !rows.length && !dq) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-ink"><Users className="h-5 w-5 text-primary" />{title} ({list.data?.meta.total ?? 0})</h2>
        <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label={`Search ${title}`} placeholder="Search your connections…" className="ps-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      </div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !rows.length ? <EmptyState icon={Users} title={dq ? 'No one matches your search' : 'Nobody here yet'} /> : (
        <div className="divide-y divide-line">{rows.map((p) => <PersonRow key={p.id} p={p} variant="table" />)}</div>
      )}
      {list.data && list.data.meta.pages > 1 && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

function SuggestionGrid() {
  const s = useSuggestions(24);
  if (s.isLoading) return <Skeleton className="h-72 rounded-card" />;
  if (!s.data?.length) return <Card><EmptyState icon={UserPlus} title="No suggestions right now" description="Complete your profile (batch, city, industry) to get better suggestions." /></Card>;
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{s.data.map((p) => <PersonGridCard key={p.id} p={p} />)}</div>;
}

function NetworkAside({ summary }: { summary?: Summary }) {
  const nav = useNavigate();
  const s = useSuggestions(4);
  const n = summary?.network;
  return (
    <>
      <Card className="p-5 text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-primary-soft"><UsersRound className="h-12 w-12 text-primary" /></div>
        <h2 className="mt-3 font-heading text-lg font-semibold text-ink">Expand Your Network</h2>
        <p className="mt-1 text-sm text-ink-muted">Connect with classmates, batchmates and fellow SST alumni.</p>
        <Button className="mt-3" onClick={() => nav('/portal/network/find')}><UserPlus />Find Alumni</Button>
      </Card>
      {!!s.data?.length && (
        <SectionCard title="People You May Know" action={<Link to="/portal/network/suggestions" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View All<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>}>
          <ul className="space-y-3">{s.data.map((p) => <MiniPerson key={p.id} p={p} />)}</ul>
        </SectionCard>
      )}
      <SectionCard title="Network Insights" icon={BarChart3}>
        <ul className="divide-y divide-line text-sm">
          {[['Total Connections', n?.connections, Users], ['Connection Requests', n?.received, UserPlus], ['People You May Know', n?.suggestions, UsersRound], ['Mutual Connections', n?.mutual, Share2]].map(([l, v, I]) => {
            const Icon = I as typeof Users;
            return <li key={l as string} className="flex items-center gap-3 py-2.5"><Icon className="h-4 w-4 text-ink-muted" /><span className="flex-1 text-ink">{l as string}</span><span className="font-semibold text-ink">{(v as number | undefined) ?? '–'}</span></li>;
          })}
        </ul>
      </SectionCard>
    </>
  );
}

// ── Find Alumni ─────────────────────────────────────────────────────────────
type Facets = { years: { value: number; count: number }[]; countries: { value: string; count: number }[]; cities: { value: string; count: number }[];
  industries: { value: string; count: number }[]; organizations: { value: string; count: number }[]; designations: { value: string; count: number }[];
  groups: { id: string; name: string; count: number }[] };
export const useFacets = () => useQuery({ queryKey: ['directory-facets'], staleTime: 60_000, queryFn: () => get<Facets>('/api/v1/alumni/directory/facets') });

export function FindAlumniPage() {
  const [sp, setSp] = useSearchParams();
  const facets = useFacets();
  const summary = useSummary();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [more, setMore] = useState(false);
  const tab = sp.get('tab') ?? 'all';
  const f = { year: sp.get('year') ?? '', country: sp.get('country') ?? '', industry: sp.get('industry') ?? '', organization: sp.get('organization') ?? '',
    profession: sp.get('profession') ?? '', group: sp.get('group') ?? '', verified: sp.get('verified') === '1', sort: sp.get('sort') ?? 'relevance', page: Number(sp.get('page') ?? 1) };
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); setSp(n, { replace: true }); };
  const me = summary.data?.me;
  const tabFilter = tab === 'same_batch' && me?.graduation_year ? { year: String(me.graduation_year) } : tab === 'same_city' && me?.city ? { city: me.city } : tab === 'same_industry' && me?.industry ? { industry: me.industry } : {};
  const params = qs({ q: sp.get('q'), year: f.year || null, country: f.country || null, industry: f.industry || null, organization: f.organization || null, profession: f.profession || null,
    group: f.group || null, verified_only: f.verified || null, sort: f.sort, page: f.page, page_size: 12, ...tabFilter });
  const list = useQuery({ queryKey: ['find-alumni', params], enabled: tab !== 'suggestions', queryFn: () => api<Paged<Person>>(`/api/v1/alumni/directory${params}`) });
  const sugg = useSuggestions(24);
  const t = summary.data?.tabs;
  const tabs = [{ k: 'all', l: `All Alumni${t ? ` (${t.all.toLocaleString()})` : ''}`, i: Users }, { k: 'suggestions', l: `People You May Know${t ? ` (${t.suggestions})` : ''}`, i: UserPlus },
    { k: 'same_batch', l: `Same Batch${t ? ` (${t.same_batch})` : ''}`, i: GraduationCap }, { k: 'same_city', l: `Same City${t ? ` (${t.same_city})` : ''}`, i: MapPin },
    { k: 'same_industry', l: `Same Industry${t ? ` (${t.same_industry})` : ''}`, i: Building2 }];
  const rows = tab === 'suggestions' ? sugg.data ?? [] : list.data?.data ?? [];
  const loading = tab === 'suggestions' ? sugg.isLoading : list.isLoading;
  const active = f.year || f.country || f.industry || f.organization || f.profession || f.group || f.verified;
  return (
    <PortalPage aside={<FindAside summary={summary.data} onBatch={(y) => set({ year: String(y), tab: null })} />}>
      <Header title="Find Alumni" crumb={['My Network', '/portal/network']} subtitle="Discover and connect with SST alumni across batches, locations and industries." />
      <form className="flex gap-2 rounded-card border border-line bg-surface p-1.5" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }}>
        <div className="relative flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input aria-label="Search alumni" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company, role, location or keywords…" className="h-10 w-full bg-transparent ps-10 text-sm outline-none" /></div>
        <Button type="submit">Search</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Batch / Year" value={f.year} onChange={(v) => set({ year: v })} options={(facets.data?.years ?? []).map((y) => [String(y.value), `Class of ${y.value} (${y.count})`])} />
        <Chip label="Location" value={f.country} onChange={(v) => set({ country: v })} options={(facets.data?.countries ?? []).map((c) => [c.value, `${c.value} (${c.count})`])} />
        <Chip label="Industry" value={f.industry} onChange={(v) => set({ industry: v })} options={(facets.data?.industries ?? []).map((c) => [c.value, `${c.value} (${c.count})`])} />
        <Chip label="Company" value={f.organization} onChange={(v) => set({ organization: v })} options={(facets.data?.organizations ?? []).map((c) => [c.value, `${c.value} (${c.count})`])} />
        <Button variant="outline" size="sm" className="h-10" onClick={() => setMore(true)}><Filter />More Filters{(f.profession || f.group || f.verified) ? ' •' : ''}</Button>
        {active && <button className="ms-auto text-sm font-semibold text-primary hover:underline" onClick={() => setSp(new URLSearchParams(sp.get('tab') ? { tab: sp.get('tab')! } : {}), { replace: true })}>Clear All</button>}
      </div>
      <div className="flex overflow-x-auto border-b border-line" role="tablist">
        {tabs.map((x) => <button key={x.k} role="tab" aria-selected={tab === x.k} onClick={() => set({ tab: x.k === 'all' ? null : x.k })}
          className={cn('flex shrink-0 items-center gap-2 border-b-[3px] px-3 py-3 text-sm font-medium', tab === x.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}><x.i className="h-4 w-4" />{x.l}</button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-ink">{tab === 'suggestions' ? `${rows.length} suggestions` : `${(list.data?.meta.total ?? 0).toLocaleString()} alumni found`}</p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-btn border border-line p-0.5" role="group" aria-label="View">
            <button aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')} className={cn('rounded px-2.5 py-1.5', view === 'list' ? 'bg-primary text-white' : 'text-ink-muted')}><List className="h-4 w-4" /></button>
            <button aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')} className={cn('rounded px-2.5 py-1.5', view === 'grid' ? 'bg-primary text-white' : 'text-ink-muted')}><LayoutGrid className="h-4 w-4" /></button>
          </div>
          {tab !== 'suggestions' && <Select aria-label="Sort" value={f.sort} onChange={(e) => set({ sort: e.target.value })} className="h-9 w-auto">
            <option value="relevance">Sort by: Relevance</option><option value="name">Name A–Z</option><option value="-year">Newest batch</option><option value="year">Oldest batch</option><option value="recent">Recently joined</option></Select>}
        </div>
      </div>
      {loading ? <Skeleton className="h-80 rounded-card" /> : !rows.length ? <Card><EmptyState icon={Users} title="No alumni found" description="Try fewer filters or a different search." /></Card>
        : view === 'grid' ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <PersonGridCard key={p.id} p={p} />)}</div>
          : <Card className="divide-y divide-line overflow-hidden">{rows.map((p) => <PersonRow key={p.id} p={p} variant="table" />)}</Card>}
      {tab !== 'suggestions' && list.data && list.data.meta.pages > 1 && <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={(n) => set({ page: String(n) })} /></Card>}
      {more && <MoreFilters f={f} facets={facets.data} onClose={() => setMore(false)} onApply={(patch) => { set(patch); setMore(false); }} />}
    </PortalPage>
  );
}

function Chip({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (v: string | null) => void }) {
  return (
    <label className={cn('relative flex h-10 items-center rounded-btn border px-3 text-sm font-medium', value ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink')}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value || null)} className="max-w-[180px] cursor-pointer appearance-none bg-transparent pe-5 outline-none">
        <option value="">{label}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span className="pointer-events-none absolute end-2.5 text-xs" aria-hidden>▾</span>
    </label>
  );
}

function MoreFilters({ f, facets, onClose, onApply }: { f: { profession: string; group: string; verified: boolean }; facets?: Facets; onClose: () => void; onApply: (p: Record<string, string | null>) => void }) {
  const [profession, setProfession] = useState(f.profession);
  const [group, setGroup] = useState(f.group);
  const [verified, setVerified] = useState(f.verified);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="More filters"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onApply({ profession: profession || null, group: group || null, verified: verified ? '1' : null })}>Apply Filters</Button></>}>
      <div className="space-y-4">
        <label className="block text-sm font-medium text-ink">Designation<Select className="mt-1" value={profession} onChange={(e) => setProfession(e.target.value)}><option value="">Any</option>
          {(facets?.designations ?? []).map((d) => <option key={d.value} value={d.value}>{d.value} ({d.count})</option>)}</Select></label>
        <label className="block text-sm font-medium text-ink">Community<Select className="mt-1" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">Any</option>
          {(facets?.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.count})</option>)}</Select></label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="accent-[rgb(var(--primary))]" />Verified profiles only<VerifiedBadge /></label>
      </div>
    </Dialog>
  );
}

function FindAside({ summary, onBatch }: { summary?: Summary; onBatch: (year: number) => void }) {
  const [invite, setInvite] = useState(false);
  const n = summary?.network;
  const join = useAction((id: string) => api(`/api/v1/community/groups/${id}/join`, { method: 'POST' }), { success: 'Done.', invalidate: [['network-summary'], ['groups']] });
  return (
    <>
      <SectionCard title="Invite & Grow Your Network" icon={UserPlus}>
        <p className="text-sm text-ink-muted">Bring your classmates and fellow alumni to the SST Alumni Portal.</p>
        <Button className="mt-3 w-full" onClick={() => setInvite(true)}><Mail />Invite Alumni</Button>
        <Button variant="outline" className="mt-2 w-full border-primary/50 text-primary" onClick={() => setInvite(true)}><Upload />Import from Contacts</Button>
      </SectionCard>
      <SectionCard title="Your Network Summary" icon={Users}>
        <div className="grid grid-cols-2 gap-3">
          {[['Connections', n?.connections, 'bg-primary-soft text-primary'], ['Mutual', n?.mutual, 'bg-success/10 text-success'], ['Batches', n?.batches, 'bg-sky-100 text-sky-700'], ['Groups', n?.groups, 'bg-amber-100 text-amber-700']].map(([l, v, c]) => (
            <div key={l as string} className="rounded-card border border-line p-3"><span className={cn('mb-2 inline-grid h-8 w-8 place-items-center rounded-full', c as string)}><Users className="h-4 w-4" /></span>
              <p className="font-heading text-xl font-semibold text-ink">{(v as number | undefined) ?? '–'}</p><p className="text-xs text-ink-muted">{l as string}</p></div>))}
        </div>
      </SectionCard>
      {!!summary?.by_batch.length && (
        <SectionCard title="Search by Batch" icon={GraduationCap}>
          <ul className="divide-y divide-line">{summary.by_batch.map((b) => <li key={b.year}><button onClick={() => onBatch(b.year)} className="flex w-full items-center gap-3 py-2 text-sm hover:text-primary">
            <Users className="h-4 w-4 text-ink-muted" /><span className="flex-1 text-start">Class of {b.year}</span><span className="font-semibold">{b.count}</span></button></li>)}</ul>
        </SectionCard>
      )}
      {!!summary?.common_groups.length && (
        <SectionCard title="Common Groups" icon={UsersRound}>
          <ul className="space-y-3">{summary.common_groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><UsersRound className="h-5 w-5" /></span>
              <Link to={`/portal/community/groups/${g.id}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink hover:text-primary">{g.name}</span><span className="block text-xs text-ink-muted">{g.member_count.toLocaleString()} members</span></Link>
              <Button size="sm" variant="outline" className="h-8 border-primary/50 px-3 text-primary" loading={join.isPending && join.variables === g.id} onClick={() => join.mutate(g.id)}>Join</Button>
            </li>))}</ul>
        </SectionCard>
      )}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
    </>
  );
}

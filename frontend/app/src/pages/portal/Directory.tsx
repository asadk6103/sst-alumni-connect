import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Filter, Loader2, Search, Users } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { NoAccess, VerifiedBadge } from '@/components/alumni';
import { PersonRow, type Person } from '@/components/people';
import { PortalPage } from '@/layouts/PortalLayout';
import { useFacets } from './Network';

type Sel = { years: string[]; cities: string[]; industries: string[]; organizations: string[]; designations: string[]; countries: string[]; group: string; verified: boolean };
const EMPTY: Sel = { years: [], cities: [], industries: [], organizations: [], designations: [], countries: [], group: '', verified: false };

function toParams(q: string, s: Sel) {
  return qs({ q: q || null, years: s.years.join(',') || null, city: s.cities.join('|') || null, industry: s.industries.join('|') || null,
    organization: s.organizations.join('|') || null, profession: s.designations.join('|') || null, country: s.countries.join('|') || null,
    group: s.group || null, verified_only: s.verified || null, page_size: 20 });
}

export function DirectoryPage() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounced(q.trim(), 300);
  const [draft, setDraft] = useState<Sel>(EMPTY);
  const [applied, setApplied] = useState<Sel>(EMPTY);
  const params = toParams(dq, applied);
  const list = useInfiniteQuery({
    queryKey: ['directory', params], initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Paged<Person>>(`/api/v1/alumni/directory${params}&page=${pageParam}`),
    getNextPageParam: (last) => (last.meta.page < last.meta.pages ? last.meta.page + 1 : undefined),
    enabled: can('portal.directory'),
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }, { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);
  if (!can('portal.directory')) return <NoAccess>The directory opens once your profile is verified by the alumni office.</NoAccess>;
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <PortalPage aside={<Filters draft={draft} setDraft={setDraft} onApply={() => setApplied(draft)} onClear={() => { setDraft(EMPTY); setApplied(EMPTY); }} />}>
      <div>
        <h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Alumni Directory</h1>
        <p className="mt-1 text-ink-muted">Search and connect with SST alumni from all batches, professions and locations.</p>
      </div>
      <div className="relative"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
        <Input aria-label="Search the directory" className="h-12 ps-12 text-[15px]" placeholder="Search by name, profession, company or keyword…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.isLoading ? <Skeleton className="h-96 rounded-card" /> : !rows.length ? <Card><EmptyState icon={Users} title="No alumni found" description="Try another search or fewer filters." /></Card> : (
        <div className="space-y-3">{rows.map((p) => <PersonRow key={p.id} p={p} />)}</div>
      )}
      <div ref={sentinel} />
      {list.isFetchingNextPage && <p className="flex items-center justify-center gap-2 py-4 text-sm text-ink-muted"><Loader2 className="h-5 w-5 animate-spin text-primary" />Loading more alumni…</p>}
    </PortalPage>
  );
}

function Section({ title, open: initial = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="border-b border-line py-3 last:border-0">
      <button className="flex w-full items-center justify-between text-[15px] font-semibold text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>{title}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Checks({ items, selected, onChange, searchable }: { items: { value: string; label: string; count: number }[]; selected: string[]; onChange: (v: string[]) => void; searchable?: string }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const shown = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  const list = all ? shown : shown.slice(0, 5);
  return (
    <div>
      {searchable && <div className="relative mb-2"><Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <input aria-label={searchable} placeholder={searchable} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full rounded-btn border border-line ps-8 text-sm outline-none focus:border-primary" /></div>}
      <ul className="space-y-1.5">{list.map((i) => (
        <li key={i.value}><label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={selected.includes(i.value)} onChange={(e) => onChange(e.target.checked ? [...selected, i.value] : selected.filter((x) => x !== i.value))} className="h-4 w-4 accent-[rgb(var(--primary))]" />
          <span className="flex-1 truncate">{i.label}</span><span className="text-xs text-ink-muted">({i.count})</span></label></li>))}</ul>
      {shown.length > 5 && <button className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary" onClick={() => setAll(!all)}>{all ? 'Show less' : 'Show More'}<ChevronDown className={cn('h-4 w-4', all && 'rotate-180')} /></button>}
      {!items.length && <p className="text-xs text-ink-muted">No options yet.</p>}
    </div>
  );
}

function Filters({ draft, setDraft, onApply, onClear }: { draft: Sel; setDraft: (s: Sel) => void; onApply: () => void; onClear: () => void }) {
  const facets = useFacets();
  const f = facets.data;
  // totals of the directory as this member sees it (plus themselves)
  const stats = useQuery({ queryKey: ['directory-totals'], staleTime: 60_000, queryFn: async () => {
    const [all, verified] = await Promise.all([api<Paged<unknown>>('/api/v1/alumni/directory?page_size=1'), api<Paged<unknown>>('/api/v1/alumni/directory?page_size=1&verified_only=true')]);
    return { total: all.meta.total + 1, verified: verified.meta.total };
  } });
  const opt = (xs?: { value: string | number; count: number }[], fmt = (v: string) => v) => (xs ?? []).map((x) => ({ value: String(x.value), label: fmt(String(x.value)), count: x.count }));
  const set = <K extends keyof Sel>(k: K, v: Sel[K]) => setDraft({ ...draft, [k]: v });
  const n = useMemo(() => Object.values(draft).reduce<number>((a, v) => a + (Array.isArray(v) ? v.length : v ? 1 : 0), 0), [draft]);
  return (
    <>
      <Card className="p-4">
        <div className="mb-1 flex items-center justify-between"><h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-ink"><Filter className="h-5 w-5 text-primary" />Filters</h2>
          <button className="text-sm font-semibold text-primary hover:underline" onClick={onClear}>Clear All</button></div>
        <Section title="Batch / Year" open><Checks searchable="Search batch…" items={opt(f?.years, (v) => `Class of ${v}`)} selected={draft.years} onChange={(v) => set('years', v)} /></Section>
        <Section title="Location"><Checks searchable="Search city…" items={opt(f?.cities)} selected={draft.cities} onChange={(v) => set('cities', v)} /></Section>
        <Section title="Industry"><Checks items={opt(f?.industries)} selected={draft.industries} onChange={(v) => set('industries', v)} /></Section>
        <Section title="Company"><Checks searchable="Search company…" items={opt(f?.organizations)} selected={draft.organizations} onChange={(v) => set('organizations', v)} /></Section>
        <Section title="Designation"><Checks searchable="Search designation…" items={opt(f?.designations)} selected={draft.designations} onChange={(v) => set('designations', v)} /></Section>
        <Section title="Country"><Checks items={opt(f?.countries)} selected={draft.countries} onChange={(v) => set('countries', v)} /></Section>
        <Section title="Community">
          <ul className="space-y-1.5">{(f?.groups ?? []).slice(0, 8).map((g) => <li key={g.id}><label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="radio" name="dir-group" checked={draft.group === g.id} onChange={() => set('group', g.id)} className="accent-[rgb(var(--primary))]" /><span className="flex-1 truncate">{g.name}</span><span className="text-xs text-ink-muted">({g.count})</span></label></li>)}</ul>
          {draft.group && <button className="mt-2 text-xs text-primary" onClick={() => set('group', '')}>Any community</button>}
        </Section>
        <Section title="Verified Profiles" open>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink"><input type="checkbox" checked={draft.verified} onChange={(e) => set('verified', e.target.checked)} className="h-4 w-4 accent-[rgb(var(--primary))]" /><VerifiedBadge />Verified Profiles Only</label>
        </Section>
        <Button className="mt-3 h-11 w-full" onClick={onApply}>Apply Filters{n ? ` (${n})` : ''}</Button>
      </Card>
      <Card className="flex items-center gap-4 p-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-card bg-primary-soft text-primary"><Users className="h-7 w-7" /></span>
        <div className="grid flex-1 grid-cols-2 divide-x divide-line rtl:divide-x-reverse">
          <div className="pe-3"><p className="font-heading text-2xl font-semibold text-ink">{stats.data?.total.toLocaleString() ?? '–'}</p><p className="text-sm text-ink-muted">Total Alumni</p></div>
          <div className="ps-3"><p className="flex items-center gap-1.5 font-heading text-2xl font-semibold text-ink"><VerifiedBadge />{stats.data?.verified.toLocaleString() ?? '–'}</p><p className="text-sm text-ink-muted">Verified Profiles</p></div>
        </div>
      </Card>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Filter, LayoutGrid, List, Search, SearchX, X } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import type { PersonCard, ProfileDetail } from '@/lib/alumni';
import { INDUSTRIES } from '@/lib/countries';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { NoAccess, PersonTile, ProfileBody, RelationActions } from '@/components/alumni';

type Facets = {
  countries: { value: string; count: number }[]; cities: { value: string; count: number }[]; industries: { value: string; count: number }[];
  years: { value: number; count: number }[]; batches: { id: string; name: string; graduation_year: number }[];
};
const FILTERS = ['batch', 'year', 'profession', 'organization', 'industry', 'country', 'city'] as const;

function storedView(): 'grid' | 'list' {
  try { return localStorage.getItem('directory-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

export function DirectoryPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'grid' | 'list'>(storedView);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [preview, setPreview] = useState<PersonCard | null>(null);
  const dq = useDebounced(q);
  const get_ = (k: string) => params.get(k) ?? '';
  const page = Number(params.get('page') ?? 1);
  const sort = get_('sort') || 'relevance';
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => { if (dq !== (params.get('q') ?? '')) update({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('directory-view', view); } catch { /* private mode */ } }, [view]);

  const query = { q: params.get('q') ?? '', ...Object.fromEntries(FILTERS.map((k) => [k, get_(k)])), sort, page, page_size: 24 };
  const list = useQuery({ queryKey: ['directory', query], queryFn: () => api<Paged<PersonCard>>(`/api/v1/alumni/directory${qs(query)}`),
    placeholderData: keepPreviousData, enabled: can('portal.directory') });
  const facets = useQuery({ queryKey: ['directory-facets'], queryFn: () => get<Facets>('/api/v1/alumni/directory/facets'), enabled: can('portal.directory'), staleTime: 60_000 });
  const active = FILTERS.filter((k) => get_(k));

  if (!can('portal.directory')) return <><PageHeader title="Alumni Directory" /><NoAccess /></>;

  const f = facets.data;
  const filterPanel = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <Field label="Batch">{(id) => <Select id={id} value={get_('batch')} onChange={(e) => update({ batch: e.target.value })}>
        <option value="">All batches</option>{f?.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
      <Field label="Graduation year">{(id) => <Select id={id} value={get_('year')} onChange={(e) => update({ year: e.target.value })}>
        <option value="">Any year</option>{f?.years.map((y) => <option key={y.value} value={y.value}>{y.value} ({y.count})</option>)}</Select>}</Field>
      <Field label="Profession">{(id) => <Input id={id} placeholder="e.g. Doctor" defaultValue={get_('profession')} onBlur={(e) => update({ profession: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && update({ profession: (e.target as HTMLInputElement).value.trim() })} />}</Field>
      <Field label="Organisation">{(id) => <Input id={id} placeholder="e.g. Aga Khan Hospital" defaultValue={get_('organization')} onBlur={(e) => update({ organization: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && update({ organization: (e.target as HTMLInputElement).value.trim() })} />}</Field>
      <Field label="Industry">{(id) => <Select id={id} value={get_('industry')} onChange={(e) => update({ industry: e.target.value })}>
        <option value="">Any industry</option>{(f?.industries.length ? f.industries.map((i) => i.value) : INDUSTRIES).map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
      <Field label="Country">{(id) => <Select id={id} value={get_('country')} onChange={(e) => update({ country: e.target.value, city: '' })}>
        <option value="">Any country</option>{f?.countries.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</Select>}</Field>
      <Field label="City">{(id) => <Select id={id} value={get_('city')} onChange={(e) => update({ city: e.target.value })}>
        <option value="">Any city</option>{f?.cities.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</Select>}</Field>
    </div>
  );

  return (
    <>
      <PageHeader title="Alumni Directory" description="Find batchmates, mentors and colleagues. Members choose what they share." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block"><Card className="sticky top-[88px] p-4"><p className="mb-3 font-heading text-sm font-semibold text-ink">Filters</p>{filterPanel}</Card></aside>
        <div className="min-w-0 space-y-4">
          <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input aria-label="Search alumni" placeholder="Search by name, batch, profession, organisation, skill or city…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="outline" className="shrink-0 lg:hidden" onClick={() => setShowFilters(true)}><Filter />Filters{active.length ? ` (${active.length})` : ''}</Button>
              <Select aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'relevance' ? '' : e.target.value })} className="min-w-0 flex-1 sm:w-auto sm:flex-none">
                <option value="relevance">Best match</option><option value="name">Name (A–Z)</option><option value="-year">Newest batch</option>
                <option value="year">Oldest batch</option><option value="recent">Recently joined</option>
              </Select>
              <div className="flex shrink-0 rounded-btn border border-line" role="group" aria-label="Layout">
                {([['grid', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
                  <button key={v} onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${v} view`}
                    className={cn('grid h-10 w-10 place-items-center', view === v ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:text-ink')}><Icon className="h-4 w-4" /></button>
                ))}
              </div>
            </div>
          </Card>
          {active.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {active.map((k) => (
                <button key={k} onClick={() => update({ [k]: '' })} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
                  {k === 'batch' ? f?.batches.find((b) => b.id === get_(k))?.name ?? 'Batch' : get_(k)}<X className="h-3 w-3" aria-label="Remove filter" />
                </button>
              ))}
              <button className="text-xs text-ink-muted underline" onClick={() => update(Object.fromEntries(FILTERS.map((k) => [k, ''])))}>Clear all</button>
            </div>
          )}
          {list.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-card" />)}</div>
          ) : list.data && list.data.data.length === 0 ? (
            <Card><EmptyState icon={SearchX} title="No alumni found" description={q || active.length ? 'Try fewer filters or a different spelling.' : 'Verified alumni appear here as they join.'} /></Card>
          ) : view === 'grid' ? (
            <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', list.isFetching && 'opacity-70')}>
              {list.data?.data.map((p) => <PersonTile key={p.id} p={p} onPreview={setPreview} />)}
            </div>
          ) : (
            <Card className={cn('divide-y divide-line', list.isFetching && 'opacity-70')}>
              {list.data?.data.map((p) => <PersonTile key={p.id} p={p} view="list" onPreview={setPreview} />)}
            </Card>
          )}
          {list.data && <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={(n) => update({ page: String(n) })} /></Card>}
        </div>
      </div>
      <Dialog open={showFilters} onOpenChange={setShowFilters} title="Filters" footer={<Button onClick={() => setShowFilters(false)}>Show results</Button>}>{filterPanel}</Dialog>
      {preview && <PreviewDialog card={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function PreviewDialog({ card, onClose }: { card: PersonCard; onClose: () => void }) {
  const q = useQuery({ queryKey: ['alumni-profile', card.id], queryFn: () => get<ProfileDetail>(`/api/v1/alumni/profiles/${card.id}`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={card.full_name} wide
      footer={<>
        {q.data && <RelationActions p={q.data} />}
        <Button asChild variant="outline"><Link to={`/portal/alumni/${card.id}`}><ExternalLink />Full profile</Link></Button>
      </>}>
      {q.data ? <ProfileBody p={q.data} header={false} /> : <Skeleton className="h-72" />}
    </Dialog>
  );
}

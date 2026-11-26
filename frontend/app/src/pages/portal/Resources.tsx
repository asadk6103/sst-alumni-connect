import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Archive, ArrowLeft, ArrowRight, Award, BookMarked, BookOpen, Bookmark, BookmarkCheck, Briefcase, ChevronRight, Clock, Download, ExternalLink, FileText,
  FolderOpen, GraduationCap, Link2, ListChecks, Newspaper, Plus, Search, Trash2, Upload, Video } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAction, useDebounced } from '@/lib/hooks';
import { pickVariant, useSite } from '@/lib/site';
import { cn, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm, useToast } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { SectionCard, fileSize, type Author } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

export type ResourceT = {
  id: string; title: string; description: string; category: string; kind: 'file' | 'link' | 'video'; file_type: string | null; size: number | null;
  status: string; rejection_reason: string | null; featured: boolean; downloads: number; uploaded_by: Author | null; created_at: string; updated_at: string;
  saved: boolean; is_mine: boolean; url: string | null;
};
type Collection = { id: string; title: string; subtitle: string; icon: string; count: number | null };
type Summary = { downloads: number; saved: number; uploads: number; categories: Record<string, number>; can_upload: boolean };

export const RES_CATS: { k: string; l: string; tile: string; icon: typeof Briefcase; bg: string }[] = [
  { k: 'career', l: 'Career', tile: 'Career Resources', icon: Briefcase, bg: 'bg-[#efe9fd] text-[#6d3fd0]' },
  { k: 'higher_studies', l: 'Higher Studies', tile: 'Higher Studies', icon: GraduationCap, bg: 'bg-[#e6f4ff] text-[#1d6fd1]' },
  { k: 'scholarships', l: 'Scholarships', tile: 'Scholarships', icon: Award, bg: 'bg-[#fff3e0] text-[#c76a00]' },
  { k: 'guides', l: 'Guides', tile: 'Guides', icon: BookOpen, bg: 'bg-[#e8f7ef] text-[#1a8a52]' },
  { k: 'publications', l: 'Publications', tile: 'Alumni Publications', icon: Newspaper, bg: 'bg-[#fde8ef] text-[#c2185b]' },
  { k: 'archives', l: 'Archives', tile: 'School Archives', icon: Archive, bg: 'bg-[#eef0f3] text-[#4a5568]' },
  { k: 'forms', l: 'Forms', tile: 'Forms & Templates', icon: ListChecks, bg: 'bg-[#e6f7f7] text-[#0f8a8a]' },
  { k: 'videos', l: 'Videos', tile: 'Videos', icon: Video, bg: 'bg-[#f3e8ff] text-[#8b2fc9]' },
];
const CHIPS = ['', 'career', 'higher_studies', 'scholarships', 'guides', 'publications', 'videos'];
const TILES = ['career', 'higher_studies', 'scholarships', 'publications', 'archives', 'forms'];
const catOf = (k: string) => RES_CATS.find((c) => c.k === k);
const TYPE_STYLE: Record<string, string> = { pdf: 'bg-[#fde8e8] text-[#d32f2f]', ppt: 'bg-[#fff0e0] text-[#e65100]', doc: 'bg-[#e3efff] text-[#1565c0]',
  xls: 'bg-[#e6f6ea] text-[#2e7d32]', video: 'bg-[#f3e8ff] text-[#8b2fc9]', link: 'bg-[#eef0f3] text-[#4a5568]' };
const COLL_ICON: Record<string, typeof Briefcase> = { briefcase: Briefcase, graduation: GraduationCap, archive: Archive, video: Video, folder: FolderOpen, award: Award, book: BookMarked };

function TypeTile({ r, size = 48 }: { r: ResourceT; size?: number }) {
  const t = r.file_type ?? (r.kind === 'file' ? 'file' : r.kind);
  return <span className={cn('grid shrink-0 place-items-center rounded-btn text-xs font-bold uppercase', TYPE_STYLE[t] ?? 'bg-primary-soft text-primary')} style={{ width: size, height: size }}>
    {r.kind === 'video' ? <Video className="h-5 w-5" /> : r.kind === 'link' ? <Link2 className="h-5 w-5" /> : t.slice(0, 4)}</span>;
}

function useResourceActions(r: ResourceT) {
  const toast = useToast();
  const inv = [['resources'], ['resources-summary']];
  const save = useAction(() => api(`/api/v1/resources/${r.id}/save`, { method: r.saved ? 'DELETE' : 'PUT' }), { success: r.saved ? 'Removed from saved.' : 'Saved.', invalidate: inv });
  const open = useAction(() => api<{ data: { url: string; filename: string | null } }>(`/api/v1/resources/${r.id}/download`, { method: 'POST' }), {
    invalidate: inv,
    onSuccess: (x) => {
      const a = Object.assign(document.createElement('a'), { href: x.data.url, target: '_blank', rel: 'noopener noreferrer', ...(x.data.filename ? { download: x.data.filename } : {}) });
      document.body.appendChild(a); a.click(); a.remove();
      if (r.kind === 'file') toast.success('Download started.');
    },
  });
  return { save, open };
}

function ResourceRow({ r }: { r: ResourceT }) {
  const { save, open } = useResourceActions(r);
  const confirm = useConfirm();
  const del = useAction(() => api(`/api/v1/resources/${r.id}`, { method: 'DELETE' }), { success: 'Resource deleted.', invalidate: [['resources'], ['resources-summary']] });
  const c = catOf(r.category);
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <TypeTile r={r} />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-[16px] font-semibold text-ink">{r.title}</p>
          {r.description && <p className="line-clamp-2 text-sm text-ink-muted">{r.description}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5" />{r.downloads.toLocaleString()} {r.kind === 'file' ? 'download' : 'view'}{r.downloads === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Updated {fmtDate(r.updated_at)}</span>
            {r.size ? <span>{fileSize(r.size)}</span> : null}
            {r.uploaded_by && <span>by {r.uploaded_by.full_name}</span>}</p>
          {r.is_mine && r.status !== 'published' && <p className="mt-1 text-xs"><Badge tone={r.status === 'rejected' ? 'danger' : 'warning'} className="capitalize">{r.status === 'pending' ? 'Waiting for review' : 'Not approved'}</Badge>
            {r.rejection_reason && <span className="ms-2 text-danger">{r.rejection_reason}</span>}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {c && <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', c.bg)}>{c.l}</span>}
        {r.status === 'published' && <Button size="icon" variant="outline" className="h-9 w-9" aria-label={r.saved ? 'Remove from saved' : 'Save resource'} aria-pressed={r.saved} onClick={() => save.mutate(undefined)}>
          {r.saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}</Button>}
        {r.status === 'published' && <Button variant="outline" className="border-primary/50 text-primary" loading={open.isPending} onClick={() => open.mutate(undefined)}>
          {r.kind === 'file' ? <><Download />Download</> : <><ExternalLink />Open</>}</Button>}
        {r.is_mine && <Button size="icon" variant="ghost" aria-label={`Delete ${r.title}`} onClick={async () => { if (await confirm({ title: `Delete “${r.title}”?`, confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}><Trash2 /></Button>}
      </div>
    </Card>
  );
}

export function ResourcesPage() {
  const site = useSite();
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category') ?? '';
  const scope = sp.get('scope') ?? 'all';
  const collection = sp.get('collection');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(1); };
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim());
  const sum = useQuery({ queryKey: ['resources-summary'], queryFn: () => get<Summary>('/api/v1/resources/summary') });
  const browsing = !category && scope === 'all' && !dq;
  const featured = useQuery({ queryKey: ['resources', 'featured'], enabled: browsing && !collection, queryFn: () => get<ResourceT[]>('/api/v1/resources?featured=true&page_size=5') });
  const params = { q: dq || null, category: category || null, scope, page, page_size: 10 };
  const list = useQuery({ queryKey: ['resources', params], enabled: !collection, queryFn: () => api<Paged<ResourceT>>(`/api/v1/resources${qs(params)}`), placeholderData: keepPreviousData });
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  const heading = scope === 'saved' ? 'Saved Resources' : scope === 'uploads' ? 'My Uploads' : scope === 'downloads' ? 'My Downloads' : category ? catOf(category)?.tile : dq ? 'Search results' : 'All Resources';
  return (
    <PortalPage aside={<ResourcesAside sum={sum.data} onScope={(s) => set('scope', s === scope ? null : s)} onCollection={(id) => set('collection', id)} />}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Resources</h1>
          <p className="mt-1 text-ink-muted">A shared knowledge hub for alumni — learning materials, career guides, documents and more.</p></div>
        {sum.data?.can_upload && <Button onClick={() => set('upload', '1')}><Plus />Upload Resource</Button>}
      </div>
      {collection ? <CollectionView id={collection} onBack={() => set('collection', null)} /> : (
        <>
          <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-[#5b2bb5] via-[#6d3fd0] to-primary">
            {banner && <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-y-0 end-0 h-full w-3/5 object-cover opacity-80 [mask-image:linear-gradient(to_right,transparent,black_50%)]" />}
            <div className="relative max-w-md px-6 py-8 text-white sm:px-8">
              <h2 className="font-heading text-2xl font-semibold sm:text-[28px]">Alumni Resource Hub</h2>
              <p className="mt-2 text-white/90">Learn • Share • Grow • Support</p>
              <Button variant="outline" className="mt-4 border-0 bg-white text-navy hover:bg-white/90" onClick={() => document.getElementById('collections')?.scrollIntoView({ behavior: 'smooth' })}>Explore Collections<ArrowRight className="rtl:rotate-180" /></Button>
            </div>
          </div>
          <div className="relative"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search resources" placeholder="Search resources by title, keyword or category…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="h-12 ps-12 text-[15px]" /></div>
          <div className="flex gap-2 overflow-x-auto pb-1">{CHIPS.map((k) => (
            <button key={k || 'all'} onClick={() => set('category', k || null)} aria-pressed={category === k}
              className={cn('shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium', category === k ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:border-primary/50')}>
              {k ? catOf(k)?.l : 'All Resources'}</button>))}</div>
          {browsing && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TILES.map((k) => { const c = catOf(k)!; return (
              <button key={k} onClick={() => set('category', k)} className={cn('flex items-center gap-3 rounded-card p-4 text-start transition hover:shadow-pop', c.bg)}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/70"><c.icon className="h-5 w-5" /></span>
                <span><span className="block font-semibold text-ink">{c.tile}</span><span className="text-sm text-ink-muted">{(sum.data?.categories[k] ?? 0).toLocaleString()} items</span></span></button>); })}</div>
          )}
          {browsing && !!featured.data?.length && <>
            <h2 className="font-heading text-lg font-semibold text-ink">Featured Resources</h2>
            <div className="space-y-3">{featured.data.map((r) => <ResourceRow key={r.id} r={r} />)}</div>
          </>}
          <div className="flex items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold text-ink">{heading}</h2>
            {(scope !== 'all' || category) && <button className="text-sm font-semibold text-primary hover:underline" onClick={() => { const n = new URLSearchParams(); setSp(n, { replace: true }); }}>Show all</button>}</div>
          {list.isLoading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
            : !list.data?.data.length ? <Card><EmptyState icon={FolderOpen} title="No resources here yet" description={scope === 'uploads' ? 'Share a guide, template or recording with fellow alumni.' : 'Try another search or category.'} /></Card>
              : <div className="space-y-3">{list.data.data.map((r) => <ResourceRow key={r.id} r={r} />)}</div>}
          {list.data && list.data.meta.pages > 1 && <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
        </>
      )}
      {sp.get('upload') === '1' && <UploadDialog onClose={() => set('upload', null)} />}
    </PortalPage>
  );
}

function CollectionView({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['resources', 'collection', id], queryFn: () => get<Collection & { resources: ResourceT[] }>(`/api/v1/resources/collections/${id}`) });
  const I = COLL_ICON[q.data?.icon ?? 'folder'] ?? FolderOpen;
  return (
    <>
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />All resources</button>
      {q.isLoading ? <Skeleton className="h-40 rounded-card" /> : !q.data ? <Card><EmptyState icon={FolderOpen} title="Collection not found" /></Card> : (
        <>
          <Card className="flex items-center gap-4 p-5"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-card bg-primary-soft text-primary"><I className="h-7 w-7" /></span>
            <div><h2 className="font-heading text-xl font-semibold text-ink">{q.data.title}</h2><p className="text-sm text-ink-muted">{q.data.subtitle} · {q.data.resources.length} items</p></div></Card>
          {!q.data.resources.length ? <Card><EmptyState icon={FolderOpen} title="This collection is empty" /></Card> : <div className="space-y-3">{q.data.resources.map((r) => <ResourceRow key={r.id} r={r} />)}</div>}
        </>
      )}
    </>
  );
}

function ResourcesAside({ sum, onScope, onCollection }: { sum?: Summary; onScope: (s: string) => void; onCollection: (id: string) => void }) {
  const cols = useQuery({ queryKey: ['resources', 'collections'], queryFn: () => get<Collection[]>('/api/v1/resources/collections'), staleTime: 60_000 });
  const recent = useQuery({ queryKey: ['resources', 'recent'], queryFn: () => get<ResourceT[]>('/api/v1/resources?page_size=5') });
  const tiles: [string, string, number | undefined, typeof Download][] = [['downloads', 'My Downloads', sum?.downloads, Download], ['saved', 'Saved Resources', sum?.saved, Bookmark], ['uploads', 'My Uploads', sum?.uploads, Upload]];
  return (
    <>
      <SectionCard title="My Resources" icon={FolderOpen}>
        <div className="grid grid-cols-3 gap-2">{tiles.map(([k, l, v, I]) => (
          <button key={k} onClick={() => onScope(k)} className="flex flex-col items-center rounded-card border border-line p-2 text-center hover:border-primary/50">
            <I className="h-5 w-5 text-primary" /><span className="mt-1 font-heading text-xl font-semibold text-ink">{v ?? '–'}</span><span className="text-xs text-ink-muted">{l}</span></button>))}</div>
      </SectionCard>
      <div id="collections"><SectionCard title="Curated Collections" icon={BookMarked}>
        {cols.isLoading ? <Skeleton className="h-28" /> : !cols.data?.length ? <p className="text-sm text-ink-muted">Collections curated by the alumni office appear here.</p> : (
          <ul className="space-y-1">{cols.data.map((c) => { const I = COLL_ICON[c.icon] ?? FolderOpen; return (
            <li key={c.id}><button onClick={() => onCollection(c.id)} className="flex w-full items-center gap-3 rounded-btn p-2 text-start hover:bg-canvas">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><I className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{c.title}</span><span className="block truncate text-xs text-ink-muted">{c.subtitle || `${c.count ?? 0} items`}</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-180" /></button></li>); })}</ul>
        )}
      </SectionCard></div>
      <SectionCard title="Recently Added" icon={Clock}>
        {recent.isLoading ? <Skeleton className="h-24" /> : !recent.data?.length ? <p className="text-sm text-ink-muted">Nothing yet.</p> : (
          <ul className="space-y-3">{recent.data.map((r) => <li key={r.id} className="flex items-center gap-3"><TypeTile r={r} size={38} />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{r.title}</span><span className="text-xs text-ink-muted">{fmtDate(r.created_at)}{r.size ? ` • ${fileSize(r.size)}` : ''}</span></span></li>)}</ul>
        )}
      </SectionCard>
    </>
  );
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ title: '', description: '', category: 'career', kind: 'file' as 'file' | 'link' | 'video', url: '' });
  const [file, setFile] = useState<{ id: string; filename: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const pick = async (x: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', x); const r = await api<{ data: { id: string; filename: string; size: number } }>('/api/v1/resources/uploads', { method: 'POST', body: fd }); setFile(r.data); if (!f.title) setF((s) => ({ ...s, title: x.name.replace(/\.[^.]+$/, '').slice(0, 200) })); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); }
  };
  const save = useAction(() => api<{ data: ResourceT }>('/api/v1/resources', { method: 'POST', body: { title: f.title, description: f.description, category: f.category, kind: f.kind,
    media_id: f.kind === 'file' ? file?.id : null, url: f.kind === 'file' ? null : f.url } }),
  { success: (r) => (r.data.status === 'published' ? 'Resource published.' : 'Thanks! The alumni office will review it before it is listed.'), invalidate: [['resources'], ['resources-summary']], onSuccess: onClose });
  const ok = f.title.trim().length >= 3 && (f.kind === 'file' ? !!file : /^https?:\/\/.+/.test(f.url));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Upload a resource" description="Share a guide, template, publication or recording. The alumni office reviews uploads before they are listed."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate(undefined)}><Upload />Submit</Button></>}>
      <div className="space-y-4">
        {save.error && !Object.keys(save.fieldErrors).length && <Alert tone="danger">{save.error.message}</Alert>}
        <div className="flex gap-2">{([['file', 'File'], ['link', 'Link'], ['video', 'Video link']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={cn('flex-1 rounded-btn border px-3 py-2 text-sm font-medium', f.kind === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink')}>{l}</button>))}</div>
        {f.kind === 'file' ? (
          <div><button type="button" onClick={() => ref.current?.click()} className="flex w-full items-center gap-3 rounded-card border-2 border-dashed border-line p-4 text-start hover:border-primary">
            <FileText className="h-8 w-8 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{busy ? 'Uploading…' : file ? file.filename : 'Choose a file'}</span>
              <span className="text-xs text-ink-muted">{file ? fileSize(file.size) : 'PDF, Word, PowerPoint, Excel, text or video'}</span></span></button>
            <input ref={ref} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.mp4,.webm,.mov" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) pick(x); }} /></div>
        ) : <Field label={f.kind === 'video' ? 'Video link' : 'Link'} error={save.fieldErrors.url}>{(id) => <Input id={id} value={f.url} placeholder="https://" onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field>}
        <Field label="Title" required error={save.fieldErrors.title}>{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{RES_CATS.map((c) => <option key={c.k} value={c.k}>{c.tile}</option>)}</Select>}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} maxLength={5000} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

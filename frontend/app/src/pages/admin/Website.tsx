import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, CalendarClock, ChevronDown, ChevronRight, Copy, ExternalLink, Eye, EyeOff, FileText, GripVertical, Globe, ImagePlus,
  Inbox, LayoutTemplate, Link2, Mail, Monitor, Newspaper, Pin, Plus, Save, Send, Smartphone, Tablet, Trash2, Undo2, X,
} from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';

type Img = { id: string; url: string; variants?: { width: number; url: string }[] } | null;

async function uploadImage(file: File, folder = 'website'): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', folder);
  fd.append('images_only', 'true');
  return (await api<{ data: { id: string; url: string } }>('/api/v1/admin/media', { method: 'POST', body: fd })).data;
}

const FORMAT_HELP = 'Formatting: # Heading, ## Subheading, - bullet, **bold**, *italic*, [label](https://link). HTML is not allowed.';

function ImagePicker({ value, url, onChange, label = 'Image' }: { value: string | null; url?: string | null; onChange: (id: string | null, url: string | null) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-ink">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {value && (url ? <img src={url} alt="" className="h-12 w-20 rounded border border-line object-cover" /> : <Badge tone="success">Image attached</Badge>)}
        <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => ref.current?.click()}><ImagePlus />{value ? 'Change' : 'Upload'}</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null, null)}>Remove</Button>}
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try { const m = await uploadImage(file); onChange(m.id, m.url); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed.'); } finally { setBusy(false); }
      }} />
    </div>
  );
}

// ── pages list ──────────────────────────────────────────────────────────────
type PageRow = { id: string; slug: string; title: string; status: string; publish_at: string | null; published_at: string | null; has_unpublished_changes: boolean;
  updated_at: string; updated_by?: string | null; blocks_count: number; is_home?: boolean };
const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'primary'> = { published: 'success', scheduled: 'primary', draft: 'neutral', archived: 'warning' };

export function PagesAdminPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['cms-pages', dq, page], queryFn: () => api<Paged<PageRow>>(`/api/v1/admin/cms/pages${qs({ q: dq || null, page })}`) });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Website pages" description="Build public pages from blocks — drafts stay private until you publish."
        actions={<>
          <Button variant="outline" onClick={() => nav('/admin/navigation')}><Link2 />Menus</Button>
          {can('cms.create') && <Button onClick={() => setCreating(true)}><Plus />New page</Button>}
        </>} />
      {creating && <NewPageDialog onClose={() => setCreating(false)} />}
      <Card>
        <div className="border-b border-line p-3"><Input placeholder="Search pages…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/pages/${r.id}`)}
          empty={<EmptyState icon={LayoutTemplate} title="No pages yet" description="Create an About page, a reunion page or anything else the website needs." />}
          columns={[
            { key: 'title', header: 'Page', cell: (r) => <div className="min-w-0"><p className="font-medium text-ink">{r.title}{r.is_home && <Badge tone="primary" className="ms-2">Home page</Badge>}</p><p className="text-xs text-ink-muted" dir="ltr">/{r.slug}</p></div> },
            { key: 'status', header: 'Status', cell: (r) => <div className="flex flex-wrap items-center gap-1.5"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status === 'archived' ? 'Unpublished' : r.status[0]!.toUpperCase() + r.status.slice(1)}</Badge>
              {r.status === 'scheduled' && r.publish_at && <span className="text-xs text-ink-muted">{fmtDateTime(r.publish_at)}</span>}
              {r.status === 'published' && r.has_unpublished_changes && <Badge tone="warning">Unpublished changes</Badge>}</div> },
            { key: 'blocks', header: 'Blocks', hideOnMobile: true, cell: (r) => r.blocks_count },
            { key: 'updated', header: 'Last edited', hideOnMobile: true, cell: (r) => <span className="text-ink-muted">{timeAgo(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</span> },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

function slugify(s: string) {
  return s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 100);
}

function NewPageDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useAction(() => api<{ data: { id: string } }>('/api/v1/admin/cms/pages', { method: 'POST', body: {
    title, slug: slug || slugify(title), blocks: [{ type: 'hero', heading: title, subheading: '' }] } }),
  { success: 'Page created as a draft.', invalidate: [['cms-pages']], onSuccess: (r) => nav(`/admin/pages/${r.data.id}`) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="New page"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={title.trim().length < 2} onClick={() => create.mutate(undefined)}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required error={create.fieldErrors.title}>{(id) => <Input id={id} value={title} autoFocus onChange={(e) => { setTitle(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} />}</Field>
        <Field label="Address" hint="Lowercase letters, numbers and dashes." error={create.fieldErrors.slug}>{(id, d) => (
          <div className="flex items-center gap-1" dir="ltr"><span className="text-sm text-ink-muted">/</span><Input id={id} aria-describedby={d} value={slug} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} /></div>)}</Field>
      </div>
    </Dialog>
  );
}

// ── page editor ─────────────────────────────────────────────────────────────
type Block = { id: string; type: string; hidden?: boolean; heading?: string; [k: string]: unknown };
type PageFull = PageRow & { seo_title: string; seo_description: string; featured_image_id: string | null; featured_image: Img; blocks: Block[]; images: Record<string, { url: string }> };

type Spec = { key: string; label: string; kind: 'text' | 'textarea' | 'rich' | 'image' | 'link' | 'select' | 'number' | 'bool' | 'items'; options?: [string, string][];
  hint?: string; item?: Spec[]; itemLabel?: string; max?: number; min?: number };
const LINK: Spec[] = [{ key: 'button_label', label: 'Button label', kind: 'text' }, { key: 'button_url', label: 'Button link', kind: 'link', hint: '/register, /contact or https://…' }];
const BLOCKS: Record<string, { label: string; description: string; fields: Spec[]; defaults: Record<string, unknown> }> = {
  hero: { label: 'Hero banner', description: 'Large heading over an image with up to two buttons.', defaults: { heading: 'Welcome', subheading: '', align: 'left', overlay: 60 }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'subheading', label: 'Subheading', kind: 'textarea' }, { key: 'image_id', label: 'Background image', kind: 'image' },
    ...LINK, { key: 'secondary_label', label: 'Second button label', kind: 'text' }, { key: 'secondary_url', label: 'Second button link', kind: 'link' },
    { key: 'align', label: 'Alignment', kind: 'select', options: [['left', 'Left'], ['center', 'Centre']] }, { key: 'overlay', label: 'Image darkening (%)', kind: 'number', min: 0, max: 90 }] },
  image_text: { label: 'Image and text', description: 'A picture beside a short story.', defaults: { heading: '', text: '', image_side: 'left' }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'text', label: 'Text', kind: 'rich' }, { key: 'image_id', label: 'Image', kind: 'image' },
    { key: 'image_side', label: 'Image position', kind: 'select', options: [['left', 'Left'], ['right', 'Right']] }, ...LINK] },
  rich_text: { label: 'Rich text', description: 'Paragraphs, headings and lists.', defaults: { heading: '', text: '' }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'text', label: 'Text', kind: 'rich' }] },
  stats: { label: 'Statistics', description: 'Headline figures — live from the database or fixed.', defaults: { heading: 'The network today', items: [{ label: 'Registered alumni', value: '', source: 'alumni' }] }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'items', label: 'Figures', kind: 'items', itemLabel: 'figure', max: 8, item: [
      { key: 'label', label: 'Label', kind: 'text' },
      { key: 'source', label: 'Live figure', kind: 'select', options: [['', 'Fixed value'], ['alumni', 'Registered alumni'], ['verified', 'Verified members'], ['countries', 'Countries'], ['batches', 'Batches'], ['events', 'Events held'], ['mentors', 'Mentors'], ['jobs', 'Jobs shared']] },
      { key: 'value', label: 'Fixed value', kind: 'text', hint: 'Used when no live figure is chosen' }] }] },
  alumni_profiles: { label: 'Alumni profiles', description: 'Hand-picked people with photo and a short text (enter only what they agreed to share).', defaults: { heading: 'Meet our alumni', items: [] }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'items', label: 'People', kind: 'items', itemLabel: 'person', max: 24, item: [
      { key: 'name', label: 'Name', kind: 'text' }, { key: 'title', label: 'Title / role', kind: 'text' }, { key: 'batch', label: 'Batch', kind: 'text' },
      { key: 'text', label: 'Short text', kind: 'textarea' }, { key: 'photo_id', label: 'Photo', kind: 'image' }] }] },
  featured_alumni: { label: 'Featured alumni', description: 'Published achievements whose owners agreed to public display.', defaults: { heading: 'Distinguished alumni', kind: '', limit: 6 }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'kind', label: 'Show', kind: 'select', options: [['', 'All achievements'], ['distinguished', 'Distinguished alumni'], ['alumni_of_month', 'Alumni of the month'], ['success_story', 'Success stories'], ['award', 'Awards'], ['milestone', 'Milestones']] },
    { key: 'limit', label: 'How many', kind: 'number', min: 1, max: 24 }] },
  events: { label: 'Events', description: 'Upcoming public events (online links are never shown).', defaults: { heading: 'Upcoming events', limit: 3 }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'limit', label: 'How many', kind: 'number', min: 1, max: 12 }] },
  news: { label: 'News', description: 'Latest published articles.', defaults: { heading: 'Latest news', category: '', limit: 3 }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'category', label: 'Category', kind: 'select', options: [['', 'All'], ['news', 'News'], ['announcement', 'Announcements'], ['success_story', 'Success stories']] },
    { key: 'limit', label: 'How many', kind: 'number', min: 1, max: 12 }] },
  gallery: { label: 'Gallery', description: 'Latest public photo albums.', defaults: { heading: 'Gallery', limit: 6 }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'limit', label: 'How many albums', kind: 'number', min: 1, max: 24 }] },
  testimonials: { label: 'Testimonials', description: 'Quotes from alumni, parents or partners.', defaults: { heading: 'What alumni say', items: [] }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'items', label: 'Quotes', kind: 'items', itemLabel: 'quote', max: 12, item: [
      { key: 'quote', label: 'Quote', kind: 'textarea' }, { key: 'name', label: 'Name', kind: 'text' }, { key: 'role', label: 'Role / batch', kind: 'text' }, { key: 'photo_id', label: 'Photo', kind: 'image' }] }] },
  cta: { label: 'Call to action', description: 'A coloured band with a button.', defaults: { heading: 'Join the alumni network', text: '', button_label: 'Register', button_url: '/register', style: 'primary' }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'text', label: 'Text', kind: 'textarea' }, ...LINK,
    { key: 'style', label: 'Colour', kind: 'select', options: [['primary', 'Purple'], ['navy', 'Navy'], ['light', 'Light']] }] },
  contact: { label: 'Contact information', description: 'Address, phone and email from the settings, with an optional form.', defaults: { heading: 'Contact the alumni office', text: '', show_form: true }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'text', label: 'Intro text', kind: 'textarea' }, { key: 'show_form', label: 'Show the contact form', kind: 'bool' }] },
  newsletter: { label: 'Newsletter subscription', description: 'Email sign-up with double opt-in.', defaults: { heading: 'Stay in touch', text: '' }, fields: [
    { key: 'heading', label: 'Heading', kind: 'text' }, { key: 'text', label: 'Text', kind: 'textarea' }] },
};
const uid = () => Math.random().toString(36).slice(2, 12);

export function PageEditorPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['cms-page', id], queryFn: () => get<PageFull>(`/api/v1/admin/cms/pages/${id}`) });
  if (q.isError) return <Alert tone="danger">This page could not be loaded.</Alert>;
  if (!q.data) return <Skeleton className="h-[480px] rounded-card" />;
  return <Editor key={q.data.updated_at} page={q.data} />;
}

function Editor({ page }: { page: PageFull }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [meta, setMeta] = useState({ title: page.title, slug: page.slug, seo_title: page.seo_title, seo_description: page.seo_description, featured_image_id: page.featured_image_id });
  const [blocks, setBlocks] = useState<Block[]>(page.blocks);
  const [images, setImages] = useState<Record<string, string>>({ ...Object.fromEntries(Object.entries(page.images ?? {}).map(([k, v]) => [k, v.url])), ...(page.featured_image ? { [page.featured_image.id]: page.featured_image.url } : {}) });
  const [open, setOpen] = useState<string | null>(blocks[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const editable = can('cms.edit');

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const body = () => ({ ...meta, blocks });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cms-pages'] }); qc.invalidateQueries({ queryKey: ['cms-page', page.id] }); };
  const save = useAction(() => api(`/api/v1/admin/cms/pages/${page.id}`, { method: 'PUT', body: body() }), { success: 'Draft saved.', onSuccess: () => { setDirty(false); refresh(); } });
  const publish = useAction(async (publish_at: string | null) => {
    if (dirty) await api(`/api/v1/admin/cms/pages/${page.id}`, { method: 'PUT', body: body() });
    return api<{ data: PageRow }>(`/api/v1/admin/cms/pages/${page.id}/publish`, { method: 'POST', body: { publish_at } });
  }, { success: (r) => (r.data.status === 'scheduled' ? 'Page scheduled.' : 'Page published.'), onSuccess: () => { setDirty(false); setScheduling(false); refresh(); } });
  const unpublish = useAction(() => api(`/api/v1/admin/cms/pages/${page.id}/unpublish`, { method: 'POST' }), { success: 'Page taken off the website.', onSuccess: refresh });
  const discard = useAction(() => api(`/api/v1/admin/cms/pages/${page.id}/discard`, { method: 'POST' }), { success: 'Changes discarded.', onSuccess: refresh });
  const duplicate = useAction(() => api<{ data: { id: string } }>(`/api/v1/admin/cms/pages/${page.id}/duplicate`, { method: 'POST' }),
    { success: 'Copy created.', onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['cms-pages'] }); nav(`/admin/pages/${r.data.id}`); } });
  const remove = useAction(() => api(`/api/v1/admin/cms/pages/${page.id}`, { method: 'DELETE' }), { success: 'Page deleted.', onSuccess: () => { qc.invalidateQueries({ queryKey: ['cms-pages'] }); nav('/admin/pages'); } });
  const openPreview = useAction(async () => {
    if (dirty) { await api(`/api/v1/admin/cms/pages/${page.id}`, { method: 'PUT', body: body() }); setDirty(false); refresh(); }
    return (await api<{ data: { path: string } }>(`/api/v1/admin/cms/pages/${page.id}/preview-token`, { method: 'POST' })).data.path;
  }, { onSuccess: (path) => setPreview(path) });

  const errs = { ...save.fieldErrors, ...publish.fieldErrors };
  const change = (fn: (b: Block[]) => Block[]) => { setBlocks(fn); setDirty(true); };
  const update = (i: number, patch: Partial<Block>) => change((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (from: number, to: number) => change((b) => { if (to < 0 || to >= b.length) return b; const c = [...b]; const [x] = c.splice(from, 1); c.splice(to, 0, x!); return c; });
  const add = (type: string) => { const b: Block = { id: uid(), type, hidden: false, ...structuredClone(BLOCKS[type]!.defaults) }; change((x) => [...x, b]); setOpen(b.id); setAdding(false); };
  const onDrop = (e: DragEvent, to: number) => { e.preventDefault(); if (dragFrom.current !== null && dragFrom.current !== to) move(dragFrom.current, to); dragFrom.current = null; };
  const live = page.status === 'published' || page.status === 'scheduled';

  return (
    <>
      <PageHeader title={meta.title || 'Untitled page'} breadcrumb={<Link to="/admin/pages" className="hover:text-ink">Website pages</Link>}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[page.status] ?? 'neutral'}>{page.status === 'archived' ? 'Unpublished' : page.status}</Badge>
          {page.status === 'scheduled' && page.publish_at && <span>goes live {fmtDateTime(page.publish_at)}</span>}
          {(dirty || (live && page.has_unpublished_changes)) && <Badge tone="warning">{dirty ? 'Unsaved changes' : 'Draft differs from the live page'}</Badge>}
          {page.status === 'published' && <a href={`/${page.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" dir="ltr">/{page.slug}<ExternalLink className="h-3.5 w-3.5" /></a>}</span>}
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openPreview.mutate(undefined)} loading={openPreview.isPending}><Eye />Preview</Button>
          {editable && <Button variant="outline" onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty}><Save />Save draft</Button>}
          {can('cms.publish') && <Button variant="outline" onClick={() => setScheduling(true)}><CalendarClock />Schedule</Button>}
          {can('cms.publish') && <Button onClick={() => publish.mutate(null)} loading={publish.isPending}><Send />{live ? 'Publish changes' : 'Publish'}</Button>}
        </div>} />
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} onConfirm={(at) => publish.mutate(at)} busy={publish.isPending} />}
      {preview && <PreviewDialog path={preview} onClose={() => setPreview(null)} />}
      {adding && <BlockPalette onPick={add} onClose={() => setAdding(false)} />}
      {Object.keys(errs).some((k) => k.startsWith('blocks.')) && <Alert tone="danger" className="mb-4" title="Some blocks need attention">{Object.entries(errs).filter(([k]) => k.startsWith('blocks.')).map(([k, v]) => {
        const i = Number(k.split('.')[1]); return <span key={k} className="block">Block {i + 1} ({BLOCKS[blocks[i]?.type ?? '']?.label ?? 'block'}): {v}</span>; })}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-3">
          {blocks.length === 0 && <Card className="p-8"><EmptyState icon={LayoutTemplate} title="This page has no blocks yet" description="Add a hero banner, some text or a list of events." /></Card>}
          {blocks.map((b, i) => {
            const def = BLOCKS[b.type];
            const expanded = open === b.id;
            const hasErr = Object.keys(errs).some((k) => k.startsWith(`blocks.${i}.`) || k === `blocks.${i}`);
            return (
              <Card key={b.id} className={cn('overflow-hidden', hasErr && 'ring-2 ring-danger/40', b.hidden && 'opacity-70')}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {editable && <span draggable onDragStart={() => { dragFrom.current = i; }} className="cursor-grab rounded p-1 text-ink-muted hover:bg-canvas active:cursor-grabbing" aria-label="Drag to reorder" title="Drag to reorder"><GripVertical className="h-4 w-4" /></span>}
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => setOpen(expanded ? null : b.id)} aria-expanded={expanded}>
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted rtl:rotate-180" />}
                    <Badge tone="primary">{def?.label ?? b.type}</Badge>
                    <span className="truncate text-sm text-ink">{(b.heading as string) || <span className="text-ink-muted">No heading</span>}</span>
                    {b.hidden && <Badge>Hidden</Badge>}
                  </button>
                  {editable && <div className="flex shrink-0 items-center">
                    <IconBtn label={b.hidden ? 'Show block' : 'Hide block'} onClick={() => update(i, { hidden: !b.hidden })}>{b.hidden ? <EyeOff /> : <Eye />}</IconBtn>
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></IconBtn>
                    <IconBtn label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></IconBtn>
                    <IconBtn label="Duplicate block" onClick={() => change((x) => [...x.slice(0, i + 1), { ...structuredClone(b), id: uid() }, ...x.slice(i + 1)])}><Copy /></IconBtn>
                    <IconBtn label="Delete block" onClick={async () => { if (await confirm({ title: 'Delete this block?', danger: true, confirmLabel: 'Delete' })) change((x) => x.filter((_, j) => j !== i)); }}><Trash2 /></IconBtn>
                  </div>}
                </div>
                {expanded && def && (
                  <div className="border-t border-line bg-canvas/40 p-4">
                    <p className="mb-3 text-xs text-ink-muted">{def.description}</p>
                    <SpecFields specs={def.fields} value={b} disabled={!editable} images={images} errors={errs} prefix={`blocks.${i}`}
                      onImage={(mid, url) => url && setImages((m) => ({ ...m, [mid]: url }))} onChange={(patch) => update(i, patch)} />
                  </div>
                )}
              </Card>
            );
          })}
          {editable && <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-line py-4 text-sm font-medium text-ink-muted hover:border-primary hover:text-primary"><Plus className="h-4 w-4" />Add a block</button>}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Page settings" />
            <div className="space-y-4 p-4">
              <Field label="Title" required error={errs.title}>{(fid) => <Input id={fid} disabled={!editable} value={meta.title} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true); }} />}</Field>
              <Field label="Address" hint={live ? 'Changing it breaks old links.' : 'Lowercase letters, numbers and dashes.'} error={errs.slug}>{(fid, d) => (
                <div className="flex items-center gap-1" dir="ltr"><span className="text-sm text-ink-muted">/</span>
                  <Input id={fid} aria-describedby={d} disabled={!editable} value={meta.slug} onChange={(e) => { setMeta({ ...meta, slug: slugify(e.target.value) }); setDirty(true); }} /></div>)}</Field>
              <ImagePicker label="Featured image (sharing preview)" value={meta.featured_image_id} url={meta.featured_image_id ? images[meta.featured_image_id] : null}
                onChange={(mid, url) => { setMeta({ ...meta, featured_image_id: mid }); if (mid && url) setImages((m) => ({ ...m, [mid]: url })); setDirty(true); }} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Search engines" icon={Globe} />
            <div className="space-y-4 p-4">
              <Field label="SEO title" hint={`${meta.seo_title.length}/70 — leave empty to use the page title.`}>{(fid, d) => <Input id={fid} aria-describedby={d} disabled={!editable} maxLength={200} value={meta.seo_title} onChange={(e) => { setMeta({ ...meta, seo_title: e.target.value }); setDirty(true); }} />}</Field>
              <Field label="SEO description" hint={`${meta.seo_description.length}/160`}>{(fid, d) => <Textarea id={fid} aria-describedby={d} disabled={!editable} maxLength={300} value={meta.seo_description} onChange={(e) => { setMeta({ ...meta, seo_description: e.target.value }); setDirty(true); }} className="min-h-[80px]" />}</Field>
              <div className="rounded-btn border border-line bg-surface p-3" aria-label="Search result preview">
                <p className="truncate text-[15px] text-[#1a0dab]">{meta.seo_title || meta.title}</p>
                <p className="truncate text-xs text-success" dir="ltr">…/{meta.slug}</p>
                <p className="line-clamp-2 text-xs text-ink-muted">{meta.seo_description || 'Add a description so search engines show a helpful summary.'}</p>
              </div>
            </div>
          </Card>
          <Card className="space-y-2 p-4">
            {live && page.has_unpublished_changes && editable && <Button variant="outline" className="w-full" onClick={async () => { if (await confirm({ title: 'Discard draft changes?', description: 'The draft returns to the published version.', danger: true, confirmLabel: 'Discard' })) discard.mutate(undefined); }}><Undo2 />Discard draft changes</Button>}
            {live && can('cms.publish') && <Button variant="outline" className="w-full" onClick={async () => { if (await confirm({ title: 'Take this page off the website?', description: 'It stays here as a draft. Menu links to it are hidden.', confirmLabel: 'Unpublish' })) unpublish.mutate(undefined); }}><EyeOff />Unpublish</Button>}
            {can('cms.create') && <Button variant="outline" className="w-full" onClick={() => duplicate.mutate(undefined)} loading={duplicate.isPending}><Copy />Duplicate page</Button>}
            {can('cms.delete') && <Button variant="ghost" className="w-full text-danger" onClick={async () => { if (await confirm({ title: `Delete “${page.title}”?`, description: 'It disappears from the website and from this list.', danger: true, confirmLabel: 'Delete' })) remove.mutate(undefined); }}><Trash2 />Delete page</Button>}
            {page.published_at && <p className="pt-1 text-center text-xs text-ink-muted">Last published {fmtDateTime(page.published_at)}</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded p-1.5 text-ink-muted hover:bg-canvas hover:text-ink disabled:opacity-30 [&>svg]:h-4 [&>svg]:w-4">{children}</button>;
}

function SpecFields({ specs, value, onChange, disabled, images, onImage, errors, prefix }: {
  specs: Spec[]; value: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; disabled?: boolean; images: Record<string, string>;
  onImage: (id: string, url: string | null) => void; errors: Record<string, string>; prefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {specs.map((s) => {
        const v = value[s.key];
        const err = errors[`${prefix}.${s.key}`];
        const wide = ['textarea', 'rich', 'items', 'image'].includes(s.kind) || s.key === 'heading';
        const cls = wide ? 'sm:col-span-2' : '';
        if (s.kind === 'bool') return <div key={s.key} className={cls}><Switch checked={!!v} disabled={disabled} onCheckedChange={(x) => onChange({ [s.key]: x })} label={s.label} /></div>;
        if (s.kind === 'image') return <div key={s.key} className={cls}><ImagePicker label={s.label} value={(v as string) || null} url={v ? images[v as string] : null} onChange={(mid, url) => { onChange({ [s.key]: mid }); if (mid) onImage(mid, url); }} /></div>;
        if (s.kind === 'items') {
          const list = (v as Record<string, unknown>[]) ?? [];
          const setList = (l: Record<string, unknown>[]) => onChange({ [s.key]: l });
          return (
            <div key={s.key} className="space-y-2 sm:col-span-2">
              <p className="text-[13px] font-medium text-ink">{s.label}</p>
              {list.map((it, j) => (
                <div key={j} className="rounded-card border border-line bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{s.itemLabel} {j + 1}</span>
                    {!disabled && <div className="flex"><IconBtn label="Move up" disabled={j === 0} onClick={() => { const c = [...list]; [c[j - 1], c[j]] = [c[j]!, c[j - 1]!]; setList(c); }}><ArrowUp /></IconBtn>
                      <IconBtn label={`Remove ${s.itemLabel}`} onClick={() => setList(list.filter((_, k) => k !== j))}><X /></IconBtn></div>}</div>
                  <SpecFields specs={s.item!} value={it} disabled={disabled} images={images} onImage={onImage} errors={errors} prefix={`${prefix}.${s.key}.${j}`}
                    onChange={(patch) => setList(list.map((x, k) => (k === j ? { ...x, ...patch } : x)))} />
                </div>
              ))}
              {!disabled && list.length < (s.max ?? 20) && <Button type="button" size="sm" variant="outline" onClick={() => setList([...list, Object.fromEntries(s.item!.map((f) => [f.key, f.kind === 'select' ? f.options?.[0]?.[0] ?? '' : f.kind === 'image' ? null : '']))])}><Plus />Add {s.itemLabel}</Button>}
            </div>
          );
        }
        return (
          <Field key={s.key} label={s.label} hint={s.kind === 'rich' ? FORMAT_HELP : s.hint} error={err} className={cls}>
            {(id, d) => s.kind === 'select' ? (
              <Select id={id} aria-describedby={d} disabled={disabled} value={String(v ?? '')} onChange={(e) => onChange({ [s.key]: e.target.value })}>{s.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            ) : s.kind === 'textarea' || s.kind === 'rich' ? (
              <Textarea id={id} aria-describedby={d} disabled={disabled} value={String(v ?? '')} onChange={(e) => onChange({ [s.key]: e.target.value })} className={s.kind === 'rich' ? 'min-h-[180px] font-mono text-[13px]' : 'min-h-[72px]'} />
            ) : s.kind === 'number' ? (
              <Input id={id} aria-describedby={d} disabled={disabled} type="number" min={s.min} max={s.max} value={String(v ?? '')} onChange={(e) => onChange({ [s.key]: e.target.value === '' ? s.min ?? 0 : Number(e.target.value) })} />
            ) : (
              <Input id={id} aria-describedby={d} disabled={disabled} value={String(v ?? '')} dir={s.kind === 'link' ? 'ltr' : undefined} onChange={(e) => onChange({ [s.key]: e.target.value })} />
            )}
          </Field>
        );
      })}
    </div>
  );
}

function BlockPalette({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Add a block" wide>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(BLOCKS).map(([k, b]) => (
          <button key={k} type="button" onClick={() => onPick(k)} className="rounded-card border border-line p-3 text-start transition-colors hover:border-primary hover:bg-primary-soft/40">
            <p className="font-medium text-ink">{b.label}</p><p className="mt-0.5 text-xs text-ink-muted">{b.description}</p>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function ScheduleDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: (iso: string) => void; busy: boolean }) {
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setMinutes(0, 0, 0);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [at, setAt] = useState(local);
  const valid = !!at && new Date(at).getTime() > Date.now();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Schedule publishing" description="The current draft goes live automatically at this time."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={() => onConfirm(new Date(at).toISOString())}><CalendarClock />Schedule</Button></>}>
      <Field label="Publish on" hint="Your local time.">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={at} min={local.slice(0, 10) + 'T00:00'} onChange={(e) => setAt(e.target.value)} />}</Field>
    </Dialog>
  );
}

const DEVICES = [{ key: 'desktop', label: 'Desktop', icon: Monitor, width: '100%' }, { key: 'tablet', label: 'Tablet', icon: Tablet, width: '820px' }, { key: 'mobile', label: 'Mobile', icon: Smartphone, width: '390px' }] as const;

function PreviewDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('desktop');
  const width = DEVICES.find((d) => d.key === device)!.width;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-navy-dark/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Page preview">
      <div className="flex items-center justify-between gap-3 bg-surface px-4 py-2.5 shadow">
        <p className="text-sm font-medium text-ink">Preview <span className="font-normal text-ink-muted">— draft, not visible to visitors</span></p>
        <div className="flex items-center gap-1 rounded-btn bg-canvas p-1" role="group" aria-label="Device">
          {DEVICES.map((d) => <button key={d.key} type="button" onClick={() => setDevice(d.key)} aria-pressed={device === d.key} title={d.label}
            className={cn('rounded p-1.5', device === d.key ? 'bg-surface text-primary shadow-sm' : 'text-ink-muted hover:text-ink')}><d.icon className="h-4 w-4" /><span className="sr-only">{d.label}</span></button>)}
        </div>
        <div className="flex items-center gap-2">
          <a href={path} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-sm text-primary hover:underline sm:inline-flex">Open in a new tab<ExternalLink className="h-3.5 w-3.5" /></a>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close preview"><X /></Button>
        </div>
      </div>
      <div className="flex flex-1 justify-center overflow-auto p-4">
        <iframe title="Page preview" src={path} className="h-full rounded-card bg-white shadow-2xl transition-[width]" style={{ width, maxWidth: '100%' }} />
      </div>
    </div>
  );
}

// ── news ────────────────────────────────────────────────────────────────────
type NewsRow = { id: string; slug: string; title: string; category: string; summary: string; cover: Img; published_at: string; pinned: boolean; members_only: boolean;
  status: 'draft' | 'published' | 'scheduled'; publish_at: string | null; updated_at: string; author: string | null; cover_id: string | null; seo_title: string | null; seo_description: string | null; body?: string | null };
const CATS: [string, string][] = [['news', 'News'], ['announcement', 'Announcement'], ['success_story', 'Success story']];

export function NewsAdminPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const list = useQuery({ queryKey: ['admin-news', status, category, page], queryFn: () => api<Paged<NewsRow>>(`/api/v1/admin/news${qs({ status: status || null, category: category || null, page })}`) });
  return (
    <>
      <PageHeader title="News & announcements" description="Articles for the website and the portal. Success stories appear in their own section."
        actions={can('news.create') && <Button onClick={() => setEditing('new')}><Plus />Write an article</Button>} />
      {editing && <NewsEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-auto" aria-label="Status"><option value="">All statuses</option><option value="draft">Drafts</option><option value="published">Published</option><option value="scheduled">Scheduled</option></Select>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-auto" aria-label="Category"><option value="">All categories</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={(r) => setEditing(r.id)}
          empty={<EmptyState icon={Newspaper} title="No articles" />}
          columns={[
            { key: 't', header: 'Article', cell: (r) => <div className="flex min-w-0 items-center gap-3">{r.cover ? <img src={r.cover.url} alt="" className="h-10 w-14 shrink-0 rounded object-cover" /> : <span className="grid h-10 w-14 shrink-0 place-items-center rounded bg-canvas"><FileText className="h-4 w-4 text-ink-muted" /></span>}
              <div className="min-w-0"><p className="flex items-center gap-1.5 font-medium text-ink">{r.pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-label="Pinned" />}{r.title}</p><p className="truncate text-xs text-ink-muted">{r.summary}</p></div></div> },
            { key: 'c', header: 'Category', hideOnMobile: true, cell: (r) => <span className="text-ink-muted">{CATS.find(([k]) => k === r.category)?.[1]}{r.members_only && ' · members only'}</span> },
            { key: 's', header: 'Status', cell: (r) => <div><Badge tone={r.status === 'published' ? 'success' : r.status === 'scheduled' ? 'primary' : 'neutral'}>{r.status}</Badge>{r.status === 'scheduled' && r.publish_at && <p className="mt-0.5 text-xs text-ink-muted">{fmtDateTime(r.publish_at)}</p>}</div> },
            { key: 'u', header: 'Updated', hideOnMobile: true, cell: (r) => <span className="text-ink-muted">{timeAgo(r.updated_at)}{r.author ? ` · ${r.author}` : ''}</span> },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

function NewsEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-news-item', id], queryFn: () => get<NewsRow>(`/api/v1/admin/news/${id}`), enabled: !!id });
  if (id && !q.data) return <Dialog open onOpenChange={(v) => !v && onClose()} title="Article" wide><Skeleton className="h-64" /></Dialog>;
  return <NewsForm n={q.data} onClose={onClose} />;
}

function NewsForm({ n, onClose }: { n?: NewsRow; onClose: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [f, setF] = useState({ title: n?.title ?? '', slug: n?.slug ?? '', category: n?.category ?? 'news', summary: n?.summary ?? '', body: n?.body ?? '', cover_id: n?.cover_id ?? null,
    pinned: n?.pinned ?? false, members_only: n?.members_only ?? false, seo_title: n?.seo_title ?? '', seo_description: n?.seo_description ?? '' });
  const [cover, setCover] = useState<string | null>(n?.cover?.url ?? null);
  const [when, setWhen] = useState('');
  const payload = () => ({ ...f, slug: f.slug || null, seo_title: f.seo_title || null, seo_description: f.seo_description || null });
  const inv = { invalidate: [['admin-news'], ['admin-news-item']] };
  const save = useAction(() => (n ? api<{ data: NewsRow }>(`/api/v1/admin/news/${n.id}`, { method: 'PUT', body: payload() }) : api<{ data: NewsRow }>('/api/v1/admin/news', { method: 'POST', body: payload() })),
    { success: 'Article saved.', ...inv, onSuccess: () => { if (!n) onClose(); } });
  const publish = useAction(async (args: { publish: boolean; at?: string }) => {
    const saved = n ? await api<{ data: NewsRow }>(`/api/v1/admin/news/${n.id}`, { method: 'PUT', body: payload() }) : await api<{ data: NewsRow }>('/api/v1/admin/news', { method: 'POST', body: payload() });
    return api<{ data: NewsRow }>(`/api/v1/admin/news/${saved.data.id}/publish`, { method: 'POST', body: { publish: args.publish, publish_at: args.at ?? null } });
  }, { success: (r) => (r.data.status === 'scheduled' ? 'Article scheduled.' : r.data.status === 'published' ? 'Article published.' : 'Article returned to draft.'), ...inv, onSuccess: onClose });
  const del = useAction(() => api(`/api/v1/admin/news/${n!.id}`, { method: 'DELETE' }), { success: 'Article deleted.', ...inv, onSuccess: onClose });
  const e = { ...save.fieldErrors, ...publish.fieldErrors };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={n ? 'Edit article' : 'New article'} description={n ? <span className="flex items-center gap-2"><Badge tone={n.status === 'published' ? 'success' : n.status === 'scheduled' ? 'primary' : 'neutral'}>{n.status}</Badge>{n.status !== 'draft' && <a className="text-primary hover:underline" href={`/news/${n.slug}`} target="_blank" rel="noreferrer">View on the website</a>}</span> : undefined}
      footer={<>
        {n && can('news.delete') && <Button variant="ghost" className="me-auto text-danger" onClick={async () => { if (await confirm({ title: 'Delete this article?', danger: true, confirmLabel: 'Delete' })) del.mutate(undefined); }}><Trash2 />Delete</Button>}
        <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(undefined)}><Save />Save</Button>
        {can('news.publish') && (n?.status === 'published' || n?.status === 'scheduled'
          ? <Button variant="outline" onClick={() => publish.mutate({ publish: false })}>Unpublish</Button>
          : <Button loading={publish.isPending} onClick={() => publish.mutate({ publish: true, at: when ? new Date(when).toISOString() : undefined })}><Send />{when ? 'Schedule' : 'Publish'}</Button>)}
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <Field label="Address" hint="Created from the title when empty." error={e.slug}>{(id, d) => <Input id={id} aria-describedby={d} dir="ltr" value={f.slug} onChange={(x) => setF({ ...f, slug: slugify(x.target.value) })} />}</Field>
        <Field label="Summary" hint="Shown on cards and in search results." className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.summary} maxLength={400} onChange={(x) => setF({ ...f, summary: x.target.value })} className="min-h-[60px]" />}</Field>
        <Field label="Article" hint={FORMAT_HELP} className="sm:col-span-2" error={e.body}>{(id, d) => <Textarea id={id} aria-describedby={d} value={f.body} maxLength={50000} onChange={(x) => setF({ ...f, body: x.target.value })} className="min-h-[220px] font-mono text-[13px]" />}</Field>
        <div className="sm:col-span-2"><ImagePicker label="Cover image" value={f.cover_id} url={cover} onChange={(mid, url) => { setF({ ...f, cover_id: mid }); setCover(url); }} /></div>
        <Checkbox checked={f.pinned} onCheckedChange={(v) => setF({ ...f, pinned: v })} label="Pin to the top" />
        <Checkbox checked={f.members_only} onCheckedChange={(v) => setF({ ...f, members_only: v })} label="Members only (portal, not the website)" />
        <Field label="SEO title">{(id) => <Input id={id} value={f.seo_title} maxLength={200} onChange={(x) => setF({ ...f, seo_title: x.target.value })} />}</Field>
        <Field label="SEO description">{(id) => <Input id={id} value={f.seo_description} maxLength={300} onChange={(x) => setF({ ...f, seo_description: x.target.value })} />}</Field>
        {can('news.publish') && n?.status !== 'published' && <Field label="Publish later" hint="Leave empty to publish now." className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={when} onChange={(x) => setWhen(x.target.value)} />}</Field>}
      </div>
    </Dialog>
  );
}

// ── navigation ──────────────────────────────────────────────────────────────
type MenuItemT = { id: string; label: string; labels: Record<string, string>; type: 'page' | 'route' | 'url'; target: string; new_tab: boolean; visible: boolean; children: MenuItemT[] };
type NavData = { data: { header: MenuItemT[]; footer: MenuItemT[] }; meta: { routes: Record<string, string>; pages: { slug: string; title: string; status: string }[] } };
const ROUTE_LABEL: Record<string, string> = { '/': 'Home', '/news': 'News', '/events': 'Events', '/gallery': 'Gallery', '/distinguished-alumni': 'Distinguished alumni', '/contact': 'Contact', '/newsletter': 'Newsletter', '/login': 'Sign in', '/register': 'Register' };

export function NavigationAdminPage() {
  const q = useQuery({ queryKey: ['admin-nav'], queryFn: () => api<NavData>('/api/v1/admin/website/navigation') });
  const [menu, setMenu] = useState<'header' | 'footer'>('header');
  return (
    <>
      <PageHeader title="Website menus" breadcrumb={<Link to="/admin/pages" className="hover:text-ink">Website pages</Link>}
        description="Links in the website header and footer. Links to unpublished pages are hidden automatically." />
      <Tabs value={menu} onValueChange={(v) => setMenu(v as 'header' | 'footer')} tabs={[{ value: 'header', label: 'Header menu' }, { value: 'footer', label: 'Footer links' }]}><span /></Tabs>
      <div className="mt-5 max-w-4xl">{!q.data ? <Skeleton className="h-80 rounded-card" /> : <MenuEditor key={menu} menuKey={menu} initial={q.data.data[menu]} meta={q.data.meta} />}</div>
    </>
  );
}

function MenuEditor({ menuKey, initial, meta }: { menuKey: 'header' | 'footer'; initial: MenuItemT[]; meta: NavData['meta'] }) {
  const { can } = useAuth();
  const [items, setItems] = useState<MenuItemT[]>(initial);
  const [dirty, setDirty] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const editable = can('navigation.edit');
  const save = useAction(() => api(`/api/v1/admin/website/navigation/${menuKey}`, { method: 'PUT', body: items }), { success: 'Menu saved.', invalidate: [['admin-nav']], onSuccess: () => setDirty(false) });
  const set = (l: MenuItemT[]) => { setItems(l); setDirty(true); };
  const blank = (): MenuItemT => ({ id: uid(), label: 'New link', labels: {}, type: 'route', target: '/', new_tab: false, visible: true, children: [] });
  const row = (it: MenuItemT, update: (p: Partial<MenuItemT>) => void, remove: () => void, controls: ReactNode, child = false) => (
    <div className={cn('rounded-card border border-line bg-surface p-3', child && 'ms-8', !it.visible && 'opacity-60')}>
      <div className="flex flex-wrap items-end gap-3">
        {controls}
        <Field label="Label" className="min-w-[140px] flex-1">{(id) => <Input id={id} disabled={!editable} value={it.label} maxLength={60} onChange={(e) => update({ label: e.target.value })} />}</Field>
        <Field label="اردو" className="min-w-[120px] flex-1">{(id) => <Input id={id} dir="rtl" disabled={!editable} value={it.labels.ur ?? ''} maxLength={60} onChange={(e) => update({ labels: { ...it.labels, ur: e.target.value } })} />}</Field>
        <Field label="Links to" className="w-36">{(id) => <Select id={id} disabled={!editable} value={it.type} onChange={(e) => {
          const type = e.target.value as MenuItemT['type'];
          update({ type, target: type === 'route' ? '/' : type === 'page' ? meta.pages[0]?.slug ?? '' : 'https://' });
        }}><option value="route">Website section</option><option value="page">Page</option><option value="url">Web address</option></Select>}</Field>
        <Field label="Target" className="min-w-[160px] flex-1">{(id) => it.type === 'route'
          ? <Select id={id} disabled={!editable} value={it.target} onChange={(e) => update({ target: e.target.value })}>{Object.keys(meta.routes).map((r) => <option key={r} value={r}>{ROUTE_LABEL[r] ?? r}</option>)}</Select>
          : it.type === 'page' ? <Select id={id} disabled={!editable} value={it.target} onChange={(e) => update({ target: e.target.value })}>{meta.pages.map((p) => <option key={p.slug} value={p.slug}>{p.title}{p.status !== 'published' ? ' (not published)' : ''}</option>)}</Select>
            : <Input id={id} dir="ltr" disabled={!editable} value={it.target} onChange={(e) => update({ target: e.target.value })} />}</Field>
        {editable && <div className="flex items-center gap-1 pb-1">
          <IconBtn label={it.visible ? 'Hide link' : 'Show link'} onClick={() => update({ visible: !it.visible })}>{it.visible ? <Eye /> : <EyeOff />}</IconBtn>
          <IconBtn label="Remove link" onClick={remove}><Trash2 /></IconBtn>
        </div>}
      </div>
      {it.type === 'url' && <div className="mt-2"><Checkbox checked={it.new_tab} disabled={!editable} onCheckedChange={(v) => update({ new_tab: v })} label="Open in a new tab" /></div>}
    </div>
  );
  return (
    <Card>
      <CardHeader title={menuKey === 'header' ? 'Header menu' : 'Footer links'} description={menuKey === 'header' ? 'Drag to reorder. Each link can have sub-links (one level).' : undefined}
        action={editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty}><Save />Save menu</Button>} />
      <div className="space-y-2 p-4">
        {save.error && <Alert tone="danger">{save.error.message}</Alert>}
        {items.map((it, i) => (
          <div key={it.id} className="space-y-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const from = dragFrom.current; if (from !== null && from !== i) { const c = [...items]; const [x] = c.splice(from, 1); c.splice(i, 0, x!); set(c); } dragFrom.current = null; }}>
            {row(it, (p) => set(items.map((x, j) => (j === i ? { ...x, ...p } : x))), () => set(items.filter((_, j) => j !== i)),
              editable ? <div className="flex items-center gap-0.5 pb-1"><span draggable onDragStart={() => { dragFrom.current = i; }} className="cursor-grab p-1 text-ink-muted" title="Drag to reorder"><GripVertical className="h-4 w-4" /></span>
                <IconBtn label="Move up" disabled={i === 0} onClick={() => { const c = [...items]; [c[i - 1], c[i]] = [c[i]!, c[i - 1]!]; set(c); }}><ArrowUp /></IconBtn>
                <IconBtn label="Move down" disabled={i === items.length - 1} onClick={() => { const c = [...items]; [c[i + 1], c[i]] = [c[i]!, c[i + 1]!]; set(c); }}><ArrowDown /></IconBtn></div> : null)}
            {it.children.map((ch, k) => <div key={ch.id}>{row(ch, (p) => set(items.map((x, j) => (j === i ? { ...x, children: x.children.map((c, m) => (m === k ? { ...c, ...p } : c)) } : x))),
              () => set(items.map((x, j) => (j === i ? { ...x, children: x.children.filter((_, m) => m !== k) } : x))), null, true)}</div>)}
            {editable && menuKey === 'header' && <button type="button" className="ms-8 text-xs font-medium text-primary hover:underline" onClick={() => set(items.map((x, j) => (j === i ? { ...x, children: [...x.children, blank()] } : x)))}>+ Add sub-link</button>}
          </div>
        ))}
        {editable && <Button variant="outline" onClick={() => set([...items, blank()])}><Plus />Add link</Button>}
      </div>
    </Card>
  );
}

// ── contact inbox ───────────────────────────────────────────────────────────
type ContactMsg = { id: string; name: string; email: string; phone: string | null; subject: string; message: string; status: string; created_at: string };

export function MessagesAdminPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [status, setStatus] = useState('new');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['contact-messages', status, page], queryFn: () => api<Paged<ContactMsg> & { meta: { new: number } }>(`/api/v1/admin/website/messages${qs({ status: status || null, page })}`) });
  const mark = useAction((a: { id: string; status: string }) => api(`/api/v1/admin/website/messages/${a.id}`, { method: 'PATCH', body: { status: a.status } }), { invalidate: [['contact-messages']] });
  const del = useAction((id: string) => api(`/api/v1/admin/website/messages/${id}`, { method: 'DELETE' }), { success: 'Message deleted.', invalidate: [['contact-messages']] });
  return (
    <>
      <PageHeader title="Website messages" description="Messages sent through the contact form on the website. Reply from your email." />
      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} tabs={[{ value: 'new', label: `New${list.data?.meta.new ? ` (${list.data.meta.new})` : ''}` }, { value: 'read', label: 'Read' }, { value: 'replied', label: 'Replied' }, { value: 'spam', label: 'Spam' }, { value: '', label: 'All' }]}><span /></Tabs>
      <Card className="mt-5">
        {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.data.length ? <EmptyState icon={Inbox} title="No messages here" /> : (
          <ul className="divide-y divide-line">
            {list.data.data.map((m) => (
              <li key={m.id}>
                <button type="button" className="flex w-full items-start gap-3 px-5 py-3 text-start hover:bg-canvas/60" aria-expanded={open === m.id}
                  onClick={() => { setOpen(open === m.id ? null : m.id); if (m.status === 'new') mark.mutate({ id: m.id, status: 'read' }); }}>
                  <Mail className={cn('mt-0.5 h-4 w-4 shrink-0', m.status === 'new' ? 'text-primary' : 'text-ink-muted')} />
                  <div className="min-w-0 flex-1"><p className={cn('truncate text-sm', m.status === 'new' ? 'font-semibold text-ink' : 'text-ink')}>{m.subject}</p><p className="truncate text-xs text-ink-muted">{m.name} · {m.email}</p></div>
                  <span className="shrink-0 text-xs text-ink-muted">{timeAgo(m.created_at)}</span>
                </button>
                {open === m.id && (
                  <div className="space-y-3 bg-canvas/40 px-5 pb-4 ps-12">
                    <p className="whitespace-pre-line text-sm text-ink">{m.message}</p>
                    <p className="text-xs text-ink-muted">{fmtDateTime(m.created_at)}{m.phone && ` · ${m.phone}`}</p>
                    <div className="flex flex-wrap gap-2">
                      <a className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90" href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`} onClick={() => mark.mutate({ id: m.id, status: 'replied' })}><Send className="h-4 w-4" />Reply by email</a>
                      {m.status !== 'replied' && <Button size="sm" variant="outline" onClick={() => mark.mutate({ id: m.id, status: 'replied' })}>Mark replied</Button>}
                      {m.status !== 'spam' && <Button size="sm" variant="outline" onClick={() => mark.mutate({ id: m.id, status: 'spam' })}>Spam</Button>}
                      {can('communications.configure') && <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete this message?', danger: true, confirmLabel: 'Delete' })) del.mutate(m.id); }}><Trash2 />Delete</Button>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}

// ── website settings (Configuration section) ───────────────────────────────
type WebsiteSettings = { home_page: string | null; footer_text: string; facebook: string | null; instagram: string | null; linkedin: string | null; youtube: string | null; x: string | null;
  show_events: boolean; contact_form: boolean; contact_recipient: string | null };

export function WebsiteSettingsPanel() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['settings', 'website'], queryFn: () => get<WebsiteSettings>('/api/v1/admin/config/settings/website') });
  const pages = useQuery({ queryKey: ['cms-pages', 'published'], queryFn: () => api<Paged<PageRow>>('/api/v1/admin/cms/pages?status=published&page_size=100') });
  const [f, setF] = useState<WebsiteSettings | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useAction(() => api('/api/v1/admin/config/settings/website', { method: 'PUT', body: { ...f, contact_recipient: f?.contact_recipient || null } }), { success: 'Settings saved.', invalidate: [['settings', 'website']] });
  const editable = can('cms.publish') || can('settings.configure');
  if (!f) return <Skeleton className="h-96 rounded-card" />;
  const e = save.fieldErrors;
  const social = (k: 'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'x', label: string) => (
    <Field label={label} error={e[k]}>{(id) => <Input id={id} dir="ltr" disabled={!editable} placeholder="https://…" value={f[k] ?? ''} onChange={(x) => setF({ ...f, [k]: x.target.value || null })} />}</Field>
  );
  return (
    <Card>
      <CardHeader title="Public website" description={<>Pages are built in <Link className="text-primary hover:underline" to="/admin/pages">Website pages</Link>; menus in <Link className="text-primary hover:underline" to="/admin/navigation">Website menus</Link>.</>}
        action={editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />Save</Button>} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Home page" hint="A published page, or the built-in landing page." error={e.home_page} className="sm:col-span-2">{(id, d) => (
          <Select id={id} aria-describedby={d} disabled={!editable} value={f.home_page ?? ''} onChange={(x) => setF({ ...f, home_page: x.target.value || null })}>
            <option value="">Built-in landing page</option>{pages.data?.data.map((p) => <option key={p.id} value={p.slug}>{p.title} (/{p.slug})</option>)}
          </Select>)}</Field>
        <Field label="Footer text" className="sm:col-span-2">{(id) => <Textarea id={id} disabled={!editable} value={f.footer_text} maxLength={500} onChange={(x) => setF({ ...f, footer_text: x.target.value })} className="min-h-[60px]" />}</Field>
        {social('facebook', 'Facebook')}{social('instagram', 'Instagram')}{social('linkedin', 'LinkedIn')}{social('youtube', 'YouTube')}{social('x', 'X (Twitter)')}
        <Field label="Contact form messages go to" hint="Defaults to the contact email in General." error={e.contact_recipient}>{(id, d) => <Input id={id} aria-describedby={d} type="email" disabled={!editable} value={f.contact_recipient ?? ''} onChange={(x) => setF({ ...f, contact_recipient: x.target.value })} />}</Field>
        <div className="rounded-card border border-line p-3"><Switch checked={f.show_events} disabled={!editable} onCheckedChange={(v) => setF({ ...f, show_events: v })} label="Show upcoming events on the website" description="Batch-only events and online meeting links are never public." /></div>
        <div className="rounded-card border border-line p-3"><Switch checked={f.contact_form} disabled={!editable} onCheckedChange={(v) => setF({ ...f, contact_form: v })} label="Contact form" description="Visitors can message the alumni office." /></div>
      </div>
    </Card>
  );
}

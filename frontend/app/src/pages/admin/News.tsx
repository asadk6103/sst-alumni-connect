import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ImagePlus, Newspaper, Pin, Plus, Save, Send, Trash2 } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm, useToast } from '@/components/ui/overlay';
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

function slugify(s: string) {
  return s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 100);
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


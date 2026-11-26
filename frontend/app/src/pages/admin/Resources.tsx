import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FolderOpen, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { fileSize } from '@/components/community';
import { RES_CATS, type ResourceT } from '@/pages/portal/Resources';

type AdminCollection = { id: string; title: string; subtitle: string; icon: string; position: number; published: boolean; resource_ids: string[] };
const ICONS = ['briefcase', 'graduation', 'archive', 'video', 'folder', 'award', 'book'];

export function ResourcesAdminPage() {
  const [tab, setTab] = useState('review');
  return (
    <>
      <PageHeader title="Resource Hub" description="Review resources shared by members, feature the best ones and curate collections." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'review', label: 'Resources' }, { value: 'collections', label: 'Collections' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'collections' ? <Collections /> : <Review />}</div>
    </>
  );
}

function Review() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<ResourceT | null>(null);
  const [reason, setReason] = useState('');
  const dq = useDebounced(q);
  const params = { status: status || null, q: dq || null, page };
  const list = useQuery({ queryKey: ['admin-resources', params], queryFn: () => api<Paged<ResourceT> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/resources${qs(params)}`), placeholderData: keepPreviousData });
  const inv = [['admin-resources'], ['resources']];
  const decide = useAction(({ id, approve, why }: { id: string; approve: boolean; why?: string }) => api(`/api/v1/admin/resources/${id}/decide`, { method: 'POST', body: { approve, reason: why ?? null } }),
    { success: 'Saved — the member was notified.', invalidate: inv, onSuccess: () => { setRejecting(null); setReason(''); } });
  const feature = useAction(({ id, featured }: { id: string; featured: boolean }) => api(`/api/v1/admin/resources/${id}/feature`, { method: 'POST', body: { featured } }), { success: 'Saved.', invalidate: inv });
  const del = useAction((id: string) => api(`/api/v1/resources/${id}`, { method: 'DELETE' }), { success: 'Resource deleted.', invalidate: inv });
  const counts = list.data?.meta.counts ?? {};
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-1">{[['pending', 'Waiting for review'], ['published', 'Published'], ['rejected', 'Rejected'], ['', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => { setStatus(k!); setPage(1); }} className={cn('rounded-btn px-3 py-1.5 text-sm font-medium', status === k ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas')}>
            {l}{k && counts[k!] ? ` (${counts[k!]})` : ''}</button>))}</div>
        <Input aria-label="Search resources" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="md:ms-auto md:w-64" />
      </div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.data.length ? <EmptyState icon={FolderOpen} title={status === 'pending' ? 'Nothing waiting for review' : 'No resources'} /> : (
        <ul className="divide-y divide-line">{list.data.data.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">{r.title}{r.featured && <Badge tone="warning"><Star className="h-3 w-3" />Featured</Badge>}
                <Badge className="capitalize">{r.status}</Badge></p>
              <p className="text-xs text-ink-muted">{RES_CATS.find((c) => c.k === r.category)?.tile} · {r.kind === 'file' ? `${(r.file_type ?? '').toUpperCase()} ${fileSize(r.size ?? 0)}` : r.kind} · {r.uploaded_by?.full_name ?? 'Staff'} · {fmtDate(r.created_at)} · {r.downloads} downloads</p>
              {r.description && <p className="line-clamp-2 text-sm text-ink">{r.description}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              {r.url && <Button asChild size="sm" variant="ghost"><a href={r.url} target="_blank" rel="noopener noreferrer"><ExternalLink />Open</a></Button>}
              {r.status === 'pending' && can('resources.approve') && <><Button size="sm" onClick={() => decide.mutate({ id: r.id, approve: true })}><Check />Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(r)}><X />Reject</Button></>}
              {r.status === 'published' && can('resources.edit') && <Button size="sm" variant="outline" onClick={() => feature.mutate({ id: r.id, featured: !r.featured })}><Star />{r.featured ? 'Unfeature' : 'Feature'}</Button>}
              {can('resources.delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${r.title}`} onClick={async () => { if (await confirm({ title: `Delete “${r.title}”?`, confirmLabel: 'Delete', danger: true })) del.mutate(r.id); }}><Trash2 /></Button>}
            </div>
          </li>))}</ul>
      )}
      {list.data && list.data.meta.pages > 1 && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      {rejecting && <Dialog open onOpenChange={(v) => !v && setRejecting(null)} title={`Reject “${rejecting.title}”`}
        footer={<><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => decide.mutate({ id: rejecting.id, approve: false, why: reason })}>Reject</Button></>}>
        <Field label="Reason (sent to the member)">{(id) => <Input id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>}
    </Card>
  );
}

function Collections() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AdminCollection | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-resource-collections'], queryFn: () => get<AdminCollection[]>('/api/v1/admin/resources/collections') });
  const del = useAction((id: string) => api(`/api/v1/admin/resources/collections/${id}`, { method: 'DELETE' }), { success: 'Collection deleted.', invalidate: [['admin-resource-collections'], ['resources']] });
  return (
    <Card>
      <div className="flex justify-end border-b border-line p-3">{can('resources.create') && <Button onClick={() => setEditing('new')}><Plus />New collection</Button>}</div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !list.data?.length ? <EmptyState icon={FolderOpen} title="No collections yet" description="Group resources into packs such as “Career Development Pack”." /> : (
        <ul className="divide-y divide-line">{list.data.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1"><p className="font-medium text-ink">{c.title}{!c.published && <Badge className="ms-2">Hidden</Badge>}</p><p className="text-xs text-ink-muted">{c.subtitle} · {c.resource_ids.length} resources</p></div>
            {can('resources.edit') && <Button size="sm" variant="outline" onClick={() => setEditing(c)}><Pencil />Edit</Button>}
            {can('resources.delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${c.title}`} onClick={async () => { if (await confirm({ title: `Delete “${c.title}”?`, description: 'Its resources stay in the hub.', confirmLabel: 'Delete', danger: true })) del.mutate(c.id); }}><Trash2 /></Button>}
          </li>))}</ul>
      )}
      {editing && <CollectionDialog c={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CollectionDialog({ c, onClose }: { c: AdminCollection | null; onClose: () => void }) {
  const [f, setF] = useState({ title: c?.title ?? '', subtitle: c?.subtitle ?? '', icon: c?.icon ?? 'folder', position: String(c?.position ?? 0), published: c?.published ?? true });
  const [ids, setIds] = useState<string[]>(c?.resource_ids ?? []);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const res = useQuery({ queryKey: ['admin-resources', 'pick', dq], queryFn: () => get<ResourceT[]>(`/api/v1/admin/resources${qs({ status: 'published', q: dq || null, page_size: 50 })}`) });
  const save = useAction(() => api(c ? `/api/v1/admin/resources/collections/${c.id}` : '/api/v1/admin/resources/collections', { method: c ? 'PUT' : 'POST',
    body: { ...f, position: Number(f.position) || 0, resource_ids: ids } }), { success: 'Collection saved.', invalidate: [['admin-resource-collections'], ['resources']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={c ? 'Edit collection' : 'New collection'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={f.title.trim().length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>{(id) => <Input id={id} value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Subtitle">{(id) => <Input id={id} value={f.subtitle} maxLength={300} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />}</Field>
        <Field label="Icon">{(id) => <Select id={id} value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>{ICONS.map((i) => <option key={i} value={i} className="capitalize">{i}</option>)}</Select>}</Field>
        <Field label="Order">{(id) => <Input id={id} type="number" min={0} value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />}</Field>
        <div className="sm:col-span-2"><Checkbox checked={f.published} onCheckedChange={(v) => setF({ ...f, published: v })} label="Show on the Resources page" /></div>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-ink">Resources ({ids.length} selected)</p>
          <Input aria-label="Find resources" placeholder="Search published resources…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-card border border-line">{(res.data ?? []).map((r) => (
            <li key={r.id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={ids.includes(r.id)} onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} className="h-4 w-4 accent-[rgb(var(--primary))]" />
              <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span><span className="text-xs text-ink-muted">{RES_CATS.find((x) => x.k === r.category)?.l}</span></label></li>))}</ul>
        </div>
      </div>
    </Dialog>
  );
}

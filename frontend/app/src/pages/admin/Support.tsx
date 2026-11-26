import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HelpCircle, LifeBuoy, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';

type Ticket = { id: string; number: string; category: string; priority: string; subject: string; description: string; status: string; created_at: string; updated_at: string;
  member: { id: string; full_name: string } | null; assigned_to: { full_name: string } | null; attachments: { id: string; filename: string; url: string }[];
  replies?: { id: string; author: { full_name: string } | null; staff: boolean; body: string; created_at: string }[] };
type Faq = { id: string; question: string; answer: string; category: string; position: number; published: boolean };
const TONE: Record<string, 'warning' | 'primary' | 'success' | 'neutral' | 'danger'> = { open: 'warning', in_progress: 'primary', resolved: 'success', closed: 'neutral', urgent: 'danger', high: 'warning', medium: 'primary', low: 'neutral' };
const label = (s: string) => (s === 'in_progress' ? 'In progress' : s[0]!.toUpperCase() + s.slice(1));

export function SupportAdminPage() {
  const [tab, setTab] = useState('tickets');
  return (
    <>
      <PageHeader title="Help Desk" description="Support requests from members and the FAQs shown under Help & Support." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'tickets', label: 'Tickets' }, { value: 'faqs', label: 'FAQs' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'faqs' ? <Faqs /> : <Tickets />}</div>
    </>
  );
}

function Tickets() {
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const params = { status: status || null, priority: priority || null, q: dq || null, page };
  const list = useQuery({ queryKey: ['admin-tickets', params], queryFn: () => api<Paged<Ticket> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/support/tickets${qs(params)}`), placeholderData: keepPreviousData });
  const counts = list.data?.meta.counts ?? {};
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-1">{['open', 'in_progress', 'resolved', 'closed', ''].map((s) => (
          <button key={s || 'all'} onClick={() => { setStatus(s); setPage(1); }} className={cn('rounded-btn px-3 py-1.5 text-sm font-medium', status === s ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas')}>
            {s ? label(s) : 'All'}{s && counts[s] ? ` (${counts[s]})` : ''}</button>))}</div>
        <Select aria-label="Priority" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="md:ms-auto md:w-36"><option value="">Any priority</option>{['urgent', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select>
        <Input aria-label="Search tickets" placeholder="Search subject or member…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="md:w-64" />
      </div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.data.length ? <EmptyState icon={LifeBuoy} title="No tickets here" /> : (
        <ul className="divide-y divide-line">{list.data.data.map((t) => (
          <li key={t.id}><button onClick={() => setOpen(t.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-start hover:bg-canvas sm:flex-row sm:items-center sm:gap-4">
            <span className="font-mono text-xs font-semibold text-primary sm:w-24">{t.number}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{t.subject}</span><span className="text-xs text-ink-muted">{t.member?.full_name} · {t.category} · updated {timeAgo(t.updated_at)}</span></span>
            <span className="flex gap-1"><Badge tone={TONE[t.priority]}>{label(t.priority)}</Badge><Badge tone={TONE[t.status]}>{label(t.status)}</Badge></span></button></li>))}</ul>
      )}
      {list.data && list.data.meta.pages > 1 && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      {open && <TicketDialog id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const [body, setBody] = useState('');
  const [next, setNext] = useState('');
  const q = useQuery({ queryKey: ['admin-ticket', id], queryFn: async () => (await api<{ data: Ticket }>(`/api/v1/support/tickets/${id}`)).data });
  const inv = [['admin-ticket', id], ['admin-tickets']];
  const reply = useAction(() => api(`/api/v1/admin/support/tickets/${id}/replies`, { method: 'POST', body: { body, status: next || null } }), { success: 'Reply sent — the member was notified.', invalidate: inv, onSuccess: () => setBody('') });
  const edit = useAction((b: Record<string, unknown>) => api(`/api/v1/admin/support/tickets/${id}`, { method: 'PATCH', body: b }), { success: 'Saved.', invalidate: inv });
  const t = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={t ? `${t.number} · ${t.subject}` : 'Ticket'}
      footer={t && can('support.edit') && <><Select aria-label="Status after reply" value={next} onChange={(e) => setNext(e.target.value)} className="w-44"><option value="">Keep status</option>{['in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>Mark {label(s).toLowerCase()}</option>)}</Select>
        <Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate(undefined)}>Send reply</Button></>}>
      {!t ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={TONE[t.status]}>{label(t.status)}</Badge>
            {can('support.edit') && <Select aria-label="Priority" value={t.priority} onChange={(e) => edit.mutate({ priority: e.target.value })} className="h-8 w-32">{['urgent', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select>}
            <span className="text-ink-muted">{t.member?.full_name} · opened {fmtDateTime(t.created_at)}{t.assigned_to ? ` · handled by ${t.assigned_to.full_name}` : ''}</span>
            {can('support.edit') && !t.assigned_to && <Button size="sm" variant="outline" onClick={() => edit.mutate({ assign_to_me: true })}>Take ticket</Button>}</div>
          <div className="rounded-card bg-canvas p-3 text-sm"><p className="whitespace-pre-line text-ink">{t.description}</p>
            {t.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-primary hover:underline"><Paperclip className="h-3.5 w-3.5" />{a.filename}</a>)}</div>
          {t.replies?.map((r) => <div key={r.id} className={cn('rounded-card p-3 text-sm', r.staff ? 'border border-primary/30 bg-primary-soft/40' : 'bg-canvas')}>
            <p className="text-xs font-semibold text-ink">{r.author?.full_name ?? 'Member'}{r.staff && ' · Staff'} <span className="font-normal text-ink-muted">· {timeAgo(r.created_at)}</span></p><p className="mt-1 whitespace-pre-line text-ink">{r.body}</p></div>)}
          {can('support.edit') && <Textarea aria-label="Reply to member" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" />}
        </div>
      )}
    </Dialog>
  );
}

function Faqs() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-faqs'], queryFn: () => get<Faq[]>('/api/v1/admin/support/faqs') });
  const del = useAction((id: string) => api(`/api/v1/admin/support/faqs/${id}`, { method: 'DELETE' }), { success: 'FAQ deleted.', invalidate: [['admin-faqs'], ['faqs']] });
  return (
    <Card>
      <div className="flex justify-end border-b border-line p-3">{can('support.edit') && <Button onClick={() => setEditing('new')}><Plus />New FAQ</Button>}</div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !list.data?.length ? <EmptyState icon={HelpCircle} title="No FAQs yet" description="Answer the questions members ask most." /> : (
        <ul className="divide-y divide-line">{list.data.map((f) => <li key={f.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><p className="font-medium text-ink">{f.question}{!f.published && <Badge className="ms-2">Hidden</Badge>}</p><p className="line-clamp-2 text-sm text-ink-muted">{f.answer}</p><p className="text-xs text-ink-muted">{f.category}</p></div>
          {can('support.edit') && <><Button size="icon" variant="ghost" aria-label={`Edit ${f.question}`} onClick={() => setEditing(f)}><Pencil /></Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${f.question}`} onClick={async () => { if (await confirm({ title: 'Delete this FAQ?', confirmLabel: 'Delete', danger: true })) del.mutate(f.id); }}><Trash2 /></Button></>}</li>)}</ul>
      )}
      {editing && <FaqDialog f={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function FaqDialog({ f, onClose }: { f: Faq | null; onClose: () => void }) {
  const [v, setV] = useState({ question: f?.question ?? '', answer: f?.answer ?? '', category: f?.category ?? 'General', position: String(f?.position ?? 0), published: f?.published ?? true });
  const save = useAction(() => api(f ? `/api/v1/admin/support/faqs/${f.id}` : '/api/v1/admin/support/faqs', { method: f ? 'PUT' : 'POST', body: { ...v, position: Number(v.position) || 0 } }),
    { success: 'FAQ saved.', invalidate: [['admin-faqs'], ['faqs']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()} wide title={f ? 'Edit FAQ' : 'New FAQ'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={v.question.trim().length < 5 || v.answer.trim().length < 5} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-[1fr_200px_100px]">
        <Field label="Question" required className="sm:col-span-3">{(id) => <Input id={id} value={v.question} maxLength={300} onChange={(e) => setV({ ...v, question: e.target.value })} />}</Field>
        <Field label="Answer" required className="sm:col-span-3">{(id) => <Textarea id={id} value={v.answer} maxLength={5000} onChange={(e) => setV({ ...v, answer: e.target.value })} className="min-h-[140px]" />}</Field>
        <Field label="Category">{(id) => <Input id={id} value={v.category} maxLength={60} onChange={(e) => setV({ ...v, category: e.target.value })} />}</Field>
        <Field label="Order">{(id) => <Input id={id} type="number" min={0} value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} />}</Field>
        <div className="flex items-end pb-2"><Checkbox checked={v.published} onCheckedChange={(x) => setV({ ...v, published: x })} label="Published" /></div>
      </div>
    </Dialog>
  );
}

import { useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, Clock, Copy, Download, Eye, FileClock, FileText, Gauge, Image as ImageIcon, Inbox, Mail, MessageSquare,
  Pencil, Search, Server, Trash2, Upload, XCircle } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import type { MediaItem } from '@/lib/site';
import { cn, fmtBytes, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/display';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, TabPanel, useConfirm, useToast } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';

// ── Communication centre ────────────────────────────────────────────────────
type Template = { id: string; key: string; channel: 'email' | 'sms' | 'inapp'; language: string; name: string; subject: string | null; body: string; placeholders: string[]; enabled: boolean; updated_at: string };
type Delivery = { id: number; channel: string; recipient: string; template: string | null; subject: string | null; status: string; error: string | null; attempts: number; created_at: string; sent_at: string | null };

export function CommunicationsPage() {
  const [tab, setTab] = useState('templates');
  return (
    <>
      <PageHeader title="Communication Center" description="Message templates and the delivery log. Campaigns and newsletters arrive with the Newsletters module." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'templates', label: 'Templates' }, { value: 'log', label: 'Delivery log' }]}>
        <TabPanel value="templates"><TemplatesPanel /></TabPanel>
        <TabPanel value="log"><DeliveryLog /></TabPanel>
      </Tabs>
    </>
  );
}

function TemplatesPanel() {
  const q = useQuery({ queryKey: ['templates'], queryFn: () => get<Template[]>('/api/v1/admin/config/templates') });
  const [editing, setEditing] = useState<Template | null>(null);
  return (
    <Card>
      <DataTable rows={q.data} loading={q.isLoading} rowKey={(t) => t.id} onRowClick={setEditing}
        empty={<EmptyState icon={FileText} title="No templates" />}
        columns={[
          { key: 'name', header: 'Template', cell: (t) => <div><p className="font-medium">{t.name}</p><p className="font-mono text-xs text-ink-muted">{t.key}</p></div> },
          { key: 'channel', header: 'Channel', cell: (t) => <Badge tone={t.channel === 'email' ? 'primary' : 'navy'}>{t.channel === 'email' ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}{t.channel.toUpperCase()}</Badge> },
          { key: 'lang', header: 'Language', cell: (t) => t.language === 'ur' ? 'اردو' : t.language.toUpperCase() },
          { key: 'status', header: 'Status', cell: (t) => <Badge tone={t.enabled ? 'success' : 'neutral'}>{t.enabled ? 'Enabled' : 'Disabled'}</Badge> },
          { key: 'updated', header: 'Updated', hideOnMobile: true, cell: (t) => <span className="text-ink-muted">{timeAgo(t.updated_at)}</span> },
        ]} />
      {editing && <TemplateDialog t={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateDialog({ t, onClose }: { t: Template; onClose: () => void }) {
  const { can } = useAuth();
  const [form, setForm] = useState({ subject: t.subject ?? '', body: t.body, enabled: t.enabled });
  const [preview, setPreview] = useState<{ subject?: string; html?: string; text?: string } | null>(null);
  const save = useAction(() => api(`/api/v1/admin/config/templates/${t.id}`, { method: 'PUT', body: form }), { success: 'Template saved.', invalidate: [['templates']], onSuccess: onClose });
  const show = useAction(() => api<{ data: { subject?: string; html?: string; text?: string } }>(`/api/v1/admin/config/templates/${t.id}/preview`, { method: 'POST', body: form }), { onSuccess: (r) => setPreview(r.data) });
  const addLang = useAction(() => api(`/api/v1/admin/config/templates/${t.id}/translations`, { method: 'POST', body: { language: 'ur' } }), { success: 'Urdu version added — edit it from the list.', invalidate: [['templates']], onSuccess: onClose });
  const editable = can('communications.configure');
  const toast = useToast();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t.name} description={`${t.channel.toUpperCase()} · ${t.language.toUpperCase()} · ${t.key}`} wide
      footer={<>
        {editable && t.language === 'en' && <Button variant="ghost" className="mr-auto" onClick={() => addLang.mutate(undefined)} loading={addLang.isPending}>Add Urdu version</Button>}
        <Button variant="outline" onClick={() => show.mutate(undefined)} loading={show.isPending}><Eye />Preview</Button>
        {editable && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button>}
      </>}>
      <div className="space-y-4" dir={t.language === 'ur' ? 'rtl' : undefined}>
        <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
          <span className="text-xs text-ink-muted">Placeholders:</span>
          {['app_name', ...t.placeholders.filter((p) => p !== 'app_name')].map((p) => (
            <button key={p} type="button" onClick={() => { navigator.clipboard?.writeText(`{{${p}}}`); toast.success(`Copied {{${p}}}`); }}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-muted hover:border-primary/40 hover:text-ink"><Copy className="h-3 w-3" />{`{{${p}}}`}</button>
          ))}
        </div>
        {t.channel === 'email' && <Field label="Subject" error={save.fieldErrors.subject}>{(id) => <Input id={id} disabled={!editable} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>}
        <Field label={t.channel === 'email' ? 'Body (HTML)' : 'Message'} error={save.fieldErrors.body} hint={t.channel === 'sms' ? `${form.body.length}/640 characters` : undefined}>
          {(id, d) => <Textarea id={id} aria-describedby={d} disabled={!editable} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={cn('font-mono text-xs', t.channel === 'email' ? 'min-h-[220px]' : 'min-h-[100px]')} />}
        </Field>
        <Switch checked={form.enabled} disabled={!editable} onCheckedChange={(v) => setForm({ ...form, enabled: v })} label="Template enabled" description="Disabled templates are not sent." />
        {preview && (
          <div className="rounded-card border border-line">
            <p className="border-b border-line px-3 py-2 text-xs font-medium text-ink-muted">Preview{preview.subject && <> · Subject: <span className="text-ink">{preview.subject}</span></>}</p>
            {preview.html ? <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[360px] w-full rounded-b-card" /> : <p className="whitespace-pre-wrap p-3 text-sm">{preview.text}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function DeliveryLog() {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const params = { channel, status, q: dq, page };
  const list = useQuery({ queryKey: ['delivery', params], queryFn: () => api<Paged<Delivery>>(`/api/v1/admin/config/delivery-logs${qs(params)}`), placeholderData: keepPreviousData });
  const tone: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = { sent: 'success', failed: 'danger', queued: 'warning', skipped: 'neutral' };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search recipient" placeholder="Search recipient…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
        <Select aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} className="md:w-40"><option value="">All channels</option><option value="email">Email</option><option value="sms">SMS</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-40"><option value="">All statuses</option><option value="sent">Sent</option><option value="queued">Queued</option><option value="failed">Failed</option><option value="skipped">Skipped</option></Select>
      </div>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(d) => d.id}
        empty={<EmptyState icon={Inbox} title="Nothing sent yet" description="Emails and SMS messages appear here with their delivery status." />}
        columns={[
          { key: 'to', header: 'Recipient', cell: (d) => <div className="min-w-0"><p className="truncate font-medium">{d.recipient}</p><p className="truncate text-xs text-ink-muted">{d.subject ?? d.template}</p></div> },
          { key: 'channel', header: 'Channel', cell: (d) => d.channel.toUpperCase() },
          { key: 'status', header: 'Status', cell: (d) => <div><Badge tone={tone[d.status] ?? 'neutral'}>{d.status}</Badge>{d.error && <p className="mt-1 max-w-xs truncate text-xs text-danger" title={d.error}>{d.error}</p>}</div> },
          { key: 'at', header: 'Created', hideOnMobile: true, cell: (d) => <span className="text-ink-muted" title={fmtDateTime(d.created_at)}>{timeAgo(d.created_at)}</span> },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

// ── Media library ───────────────────────────────────────────────────────────
export function MediaPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q);
  const params = { q: dq, kind, page, page_size: 24 };
  const list = useQuery({ queryKey: ['media', params], queryFn: () => api<Paged<MediaItem>>(`/api/v1/admin/media${qs(params)}`), placeholderData: keepPreviousData });
  const upload = useAction(async (files: File[]) => {
    for (const f of files) {
      const fd = new FormData();
      fd.set('file', f);
      await api('/api/v1/admin/media', { method: 'POST', body: fd });
    }
    return files.length;
  }, { success: (n) => `${n} file${n === 1 ? '' : 's'} uploaded.`, invalidate: [['media']] });
  const [alt, setAlt] = useState('');
  const saveAlt = useAction(() => api(`/api/v1/admin/media/${selected!.id}`, { method: 'PATCH', body: { alt } }), { success: 'Saved.', invalidate: [['media']] });
  const del = useAction((id: string) => api(`/api/v1/admin/media/${id}`, { method: 'DELETE' }), { success: 'File deleted.', invalidate: [['media']], onSuccess: () => setSelected(null) });
  return (
    <>
      <PageHeader title="Media Library" description="Images and documents used across the platform. Images get resized copies automatically."
        actions={can('media.create') && <Button onClick={() => ref.current?.click()} loading={upload.isPending}><Upload />Upload</Button>} />
      <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) upload.mutate(f); e.target.value = ''; }} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search files" placeholder="Search by file name or description…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
          <Select aria-label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="md:w-44"><option value="">All files</option><option value="image">Images</option><option value="document">Documents</option></Select>
        </div>
        {list.isLoading ? (
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-card" />)}</div>
        ) : !list.data?.data.length ? (
          <EmptyState icon={ImageIcon} title="No files yet" description="Upload logos, banners, photos and documents." />
        ) : (
          <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 xl:grid-cols-6">
            {list.data.data.map((m) => (
              <li key={m.id}>
                <button onClick={() => { setSelected(m); setAlt(m.alt); }} className="group block w-full text-left">
                  <span className="grid aspect-square place-items-center overflow-hidden rounded-card border border-line bg-canvas">
                    {m.mime.startsWith('image/') ? <img src={m.variants[1]?.url ?? m.variants[0]?.url ?? m.url} alt={m.alt} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      : <FileText className="h-10 w-10 text-ink-muted" />}
                  </span>
                  <span className="mt-1.5 block truncate text-xs text-ink">{m.filename}</span>
                  <span className="block text-[11px] text-ink-muted">{fmtBytes(m.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {selected && (
        <Dialog open onOpenChange={(v) => !v && setSelected(null)} title={selected.filename} wide
          footer={<>
            {can('media.delete') && <Button variant="danger-outline" className="mr-auto" onClick={async () => { if (await confirm({ title: 'Delete file?', description: 'Pages using this file will no longer show it.', danger: true, confirmLabel: 'Delete' })) del.mutate(selected.id); }}><Trash2 />Delete</Button>}
            <Button variant="outline" asChild><a href={selected.url} target="_blank" rel="noreferrer"><Download />Open</a></Button>
            {can('media.edit') && <Button onClick={() => saveAlt.mutate(undefined)} loading={saveAlt.isPending}><Pencil />Save</Button>}
          </>}>
          <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
            <div className="grid min-h-[200px] place-items-center rounded-card bg-canvas p-3">
              {selected.mime.startsWith('image/') ? <img src={selected.variants.at(-1)?.url ?? selected.url} alt={selected.alt} className="max-h-[360px] object-contain" /> : <FileText className="h-14 w-14 text-ink-muted" />}
            </div>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-ink-muted">Type</dt><dd>{selected.mime}</dd></div>
              <div><dt className="text-xs text-ink-muted">Size</dt><dd>{fmtBytes(selected.size)}{selected.width && ` · ${selected.width}×${selected.height}`}</dd></div>
              <div><dt className="text-xs text-ink-muted">Uploaded</dt><dd>{fmtDateTime(selected.created_at)}</dd></div>
              {selected.variants.length > 0 && <div><dt className="text-xs text-ink-muted">Resized copies</dt><dd>{selected.variants.map((v) => `${v.width}px`).join(', ')}</dd></div>}
            </dl>
          </div>
          <Field label="Alternative text" hint="Describes the image for screen readers and search engines." className="mt-4">
            {(id, d) => <Input id={id} aria-describedby={d} disabled={!can('media.edit')} value={alt} onChange={(e) => setAlt(e.target.value)} />}
          </Field>
        </Dialog>
      )}
    </>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────────
type AuditRow = { id: number; action: string; entity: string; entity_id: string | null; summary: string; data: unknown; ip: string | null; created_at: string; actor: { name: string; email: string } | null };

export function AuditPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ q: '', actor: '', entity: '', date_from: '', date_to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const dq = useDebounced(f);
  const params = { ...dq, page };
  const list = useQuery({ queryKey: ['audit', params], queryFn: () => api<Paged<AuditRow>>(`/api/v1/admin/audit-logs${qs(params)}`), placeholderData: keepPreviousData });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Audit Logs" description="A permanent record of important actions."
        actions={can('audit.export') && <Button variant="outline" onClick={() => download(`/api/v1/admin/audit-logs/export${qs(dq)}`, 'audit-log.csv')}><Download />Export CSV</Button>} />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-5">
          <Input aria-label="Search" placeholder="Search summary…" value={f.q} onChange={(e) => set('q', e.target.value)} className="md:col-span-2" />
          <Input aria-label="Actor" placeholder="Actor name or email" value={f.actor} onChange={(e) => set('actor', e.target.value)} />
          <Input aria-label="From date" type="date" value={f.date_from} onChange={(e) => set('date_from', e.target.value)} />
          <Input aria-label="To date" type="date" value={f.date_to} onChange={(e) => set('date_to', e.target.value)} />
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={setOpen}
          empty={<EmptyState icon={FileClock} title="No entries match" />}
          columns={[
            { key: 'when', header: 'When', cell: (r) => <span className="whitespace-nowrap text-ink-muted" title={fmtDateTime(r.created_at)}>{timeAgo(r.created_at)}</span> },
            { key: 'actor', header: 'Actor', cell: (r) => r.actor ? <div className="min-w-0"><p className="truncate font-medium">{r.actor.name}</p><p className="truncate text-xs text-ink-muted">{r.actor.email}</p></div> : <span className="text-ink-muted">System</span> },
            { key: 'action', header: 'Action', cell: (r) => <Badge tone="primary">{r.entity}.{r.action}</Badge> },
            { key: 'summary', header: 'Summary', cell: (r) => <span className="line-clamp-2">{r.summary}</span> },
            { key: 'ip', header: 'IP', hideOnMobile: true, cell: (r) => <span className="font-mono text-xs text-ink-muted">{r.ip ?? '—'}</span> },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {open && (
        <Dialog open onOpenChange={(v) => !v && setOpen(null)} title={open.summary} description={`${fmtDateTime(open.created_at)} · ${open.actor?.email ?? 'System'}`} wide>
          <pre className="max-h-[50vh] overflow-auto rounded-card bg-canvas p-3 text-xs">{JSON.stringify({ action: open.action, entity: open.entity, entity_id: open.entity_id, ip: open.ip, details: open.data }, null, 2)}</pre>
        </Dialog>
      )}
    </>
  );
}

// ── System health ───────────────────────────────────────────────────────────
type HealthData = { checks: Record<string, { ok: boolean; ms: number; message: string }>; stats: { users: number; deliveries_failed_24h: number; db_pool: { size: number; checked_out: number; overflow: number } | null };
  latency: { route: string; count: number; p50_ms: number; p95_ms: number; p99_ms: number }[]; note: string };

export function HealthPage() {
  const q = useQuery({ queryKey: ['admin-health'], queryFn: () => get<HealthData>('/api/v1/admin/health'), refetchInterval: 15_000 });
  const d = q.data;
  const icons: Record<string, typeof Server> = { database: Server, redis: Gauge, storage: ImageIcon, queue: Clock };
  return (
    <>
      <PageHeader title="System Health" description="Live checks, refreshed every 15 seconds." actions={<Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}><Activity />Refresh</Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {d ? Object.entries(d.checks).map(([k, c]) => {
          const Icon = icons[k] ?? Server;
          return (
            <Card key={k} className="p-5">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-medium capitalize text-ink"><Icon className="h-4 w-4 text-primary" />{k}</span>
                {c.ok ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" />OK</Badge> : <Badge tone="danger"><XCircle className="h-3 w-3" />Problem</Badge>}</div>
              <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{c.message}</p>
              <p className="mt-1 text-xs text-ink-muted">{c.ms} ms</p>
            </Card>
          );
        }) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}
      </div>
      {d && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <StatTile icon={Server} tone="navy" value={d.stats.db_pool ? `${d.stats.db_pool.checked_out}/${d.stats.db_pool.size}` : '—'} label="Database connections in use" />
          <StatTile icon={Mail} tone={d.stats.deliveries_failed_24h ? 'warning' : 'success'} value={d.stats.deliveries_failed_24h} label="Failed deliveries (24 h)" />
          <StatTile icon={Gauge} value={d.latency.length ? `${Math.max(...d.latency.map((l) => l.p95_ms))} ms` : '—'} label="Slowest route p95" />
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="API latency" icon={Gauge} description={d?.note} />
        {d && d.latency.length === 0 ? <EmptyState icon={Gauge} title="No requests measured yet" /> : (
          <DataTable rows={d?.latency} loading={!d} rowKey={(r) => r.route}
            columns={[
              { key: 'route', header: 'Route', cell: (r) => <span className="font-mono text-xs">{r.route}</span> },
              { key: 'count', header: 'Requests', cell: (r) => r.count.toLocaleString() },
              { key: 'p50', header: 'p50', cell: (r) => `${r.p50_ms} ms` },
              { key: 'p95', header: 'p95', cell: (r) => <span className={cn('font-medium', r.p95_ms > 300 ? 'text-danger' : r.p95_ms > 150 ? 'text-warning' : 'text-success')}>{r.p95_ms} ms</span> },
              { key: 'p99', header: 'p99', cell: (r) => `${r.p99_ms} ms` },
            ]} />
        )}
      </Card>
      {q.isError && <Alert tone="danger" className="mt-4">Could not load health information.</Alert>}
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, GraduationCap, MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/display';
import { Field, Input, Switch, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';

type Batch = {
  id: string; name: string; graduation_year: number; admission_year: number | null; description: string; is_active: boolean;
  coordinator: { id: string; full_name: string; email: string } | null; members: number; verified: number; pending: number; created_at: string;
};
const INVALIDATE = [['admin-batches'], ['admin-batches-brief']];

export function BatchesPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Batch | 'new' | null>(null);
  const [generating, setGenerating] = useState(false);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['admin-batches', dq], queryFn: () => api<{ data: Batch[]; meta: { unassigned: number } }>(`/api/v1/admin/batches${qs({ q: dq })}`) });
  const del = useAction((id: string) => api(`/api/v1/admin/batches/${id}`, { method: 'DELETE' }), { success: 'Batch deleted.', invalidate: INVALIDATE });
  const unassigned = list.data?.meta.unassigned ?? 0;
  return (
    <>
      <PageHeader title="Batch Management" description="Graduating classes. Members choose their batch at registration; verified details are kept here."
        actions={<>
          {can('batches.create') && <Button variant="outline" onClick={() => setGenerating(true)}><CalendarRange />Create for a range of years</Button>}
          {can('batches.create') && <Button onClick={() => setEditing('new')}><Plus />Add batch</Button>}
        </>} />
      {unassigned > 0 && can('alumni.view') && (
        <Alert tone="info" className="mb-5">{unassigned} member(s) have no batch yet. When a graduation year has exactly one batch, members of that year are assigned automatically when you create batches for a range of years; otherwise assign them in <Link to="/admin/alumni" className="font-medium text-primary underline">Alumni Management</Link>.</Alert>
      )}
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search batches" placeholder="Search batches…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(b) => b.id}
          empty={<EmptyState icon={GraduationCap} title="No batches yet" description="Create one batch per graduating class, or generate them for a range of years."
            action={can('batches.create') && <Button onClick={() => setGenerating(true)}><CalendarRange />Create for a range of years</Button>} />}
          columns={[
            { key: 'name', header: 'Batch', cell: (b) => <div><p className="font-medium">{b.name}{!b.is_active && <Badge className="ml-2">Inactive</Badge>}</p>{b.description && <p className="max-w-xs truncate text-xs text-ink-muted">{b.description}</p>}</div> },
            { key: 'years', header: 'Years', cell: (b) => <span className="tabular-nums">{b.admission_year ? `${b.admission_year} – ` : ''}{b.graduation_year}</span> },
            { key: 'members', header: 'Members', cell: (b) => (
              <Link to={`/admin/alumni?batch=${b.id}`} className="inline-flex items-center gap-1.5 hover:text-primary"><Users className="h-4 w-4 text-ink-muted" />{b.members}
                <span className="text-xs text-ink-muted">({b.verified} verified{b.pending ? `, ${b.pending} pending` : ''})</span></Link>) },
            { key: 'coord', header: 'Coordinator', hideOnMobile: true, cell: (b) => b.coordinator ? <span title={b.coordinator.email}>{b.coordinator.full_name}</span> : <span className="text-ink-muted">—</span> },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: (b) => (can('batches.edit') || can('batches.delete')) && (
              <Menu>
                <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${b.name}`}><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent>
                  {can('batches.edit') && <MenuItem onSelect={() => setEditing(b)}><Pencil />Edit</MenuItem>}
                  {can('batches.delete') && (<><MenuSeparator /><MenuItem danger onSelect={async () => {
                    if (await confirm({ title: `Delete ${b.name}?`, description: b.members ? `${b.members} member(s) keep their graduation year but lose this batch.` : undefined, confirmLabel: 'Delete', danger: true })) del.mutate(b.id);
                  }}><Trash2 />Delete</MenuItem></>)}
                </MenuContent>
              </Menu>) },
          ]} />
      </Card>
      {editing && <BatchDialog batch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {generating && <GenerateDialog onClose={() => setGenerating(false)} />}
    </>
  );
}

function BatchDialog({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: batch?.name ?? '', graduation_year: batch?.graduation_year ? String(batch.graduation_year) : String(new Date().getFullYear()),
    admission_year: batch?.admission_year ? String(batch.admission_year) : '', description: batch?.description ?? '', is_active: batch?.is_active ?? true,
  });
  const save = useAction(() => api(batch ? `/api/v1/admin/batches/${batch.id}` : '/api/v1/admin/batches', { method: batch ? 'PUT' : 'POST', body: {
    name: f.name, graduation_year: Number(f.graduation_year), admission_year: f.admission_year ? Number(f.admission_year) : null,
    description: f.description, is_active: f.is_active, coordinator_id: batch?.coordinator?.id ?? null,
  } }), { success: batch ? 'Batch updated.' : 'Batch created.', invalidate: INVALIDATE, onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={batch ? `Edit ${batch.name}` : 'Add batch'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={e.name} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} placeholder="e.g. Class of 2015 – Science" />}</Field>
        <Field label="Graduation year" required error={e.graduation_year}>{(id) => <Input id={id} type="number" value={f.graduation_year} onChange={(x) => setF({ ...f, graduation_year: x.target.value })} />}</Field>
        <Field label="Admission year" error={e.admission_year}>{(id) => <Input id={id} type="number" value={f.admission_year} onChange={(x) => setF({ ...f, admission_year: x.target.value })} />}</Field>
        <Field label="Description" error={e.description} className="sm:col-span-2">{(id) => <Textarea id={id} maxLength={500} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} className="min-h-[70px]" />}</Field>
        <div className="sm:col-span-2"><Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} label="Active" description="Inactive batches are hidden from registration and filters." /></div>
      </div>
    </Dialog>
  );
}

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const y = new Date().getFullYear();
  const [f, setF] = useState({ from_year: String(y - 20), to_year: String(y), pattern: 'Class of {year}' });
  const run = useAction(() => api<{ data: { created: string[] } }>('/api/v1/admin/batches/generate', { method: 'POST', body: { ...f, from_year: Number(f.from_year), to_year: Number(f.to_year) } }),
    { success: (r) => (r.data.created.length ? `${r.data.created.length} batch(es) created.` : 'All those batches already exist.'), invalidate: [...INVALIDATE, ['admin-alumni']], onSuccess: onClose });
  const e = run.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Create batches for a range of years" description="Existing batches are skipped."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={run.isPending} onClick={() => run.mutate(undefined)}>Create</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From graduation year" error={e.from_year}>{(id) => <Input id={id} type="number" value={f.from_year} onChange={(x) => setF({ ...f, from_year: x.target.value })} />}</Field>
        <Field label="To graduation year" error={e.to_year}>{(id) => <Input id={id} type="number" value={f.to_year} onChange={(x) => setF({ ...f, to_year: x.target.value })} />}</Field>
        <Field label="Name pattern" error={e.pattern} hint="{year} is replaced by the graduation year." className="sm:col-span-2">{(id, d) => <Input id={id} aria-describedby={d} value={f.pattern} onChange={(x) => setF({ ...f, pattern: x.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

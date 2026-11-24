import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Ban, Check, Copy, Download, FileSpreadsheet, FileText, KeyRound, Mail, Plus, Search, ShieldCheck, Trash2, Upload,
  X } from 'lucide-react';
import { api, download, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, StatTile } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import { AlumniDetailDialog, DecisionDialog, useBatches, VLABEL, type AlumniRow } from './Alumni';

export function VerificationPage() {
  const { tab = 'queue' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const tabs = [
    { value: 'queue', label: 'Verification queue' },
    ...(can('alumni.view') ? [{ value: 'records', label: 'School records' }] : []),
    ...(can('verification.approve') ? [{ value: 'codes', label: 'Verification codes' }] : []),
  ];
  return (
    <>
      <PageHeader title="Alumni Verification" description="Approve registrations, match them with school records and issue verification codes." />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'queue' ? '/admin/verification' : `/admin/verification/${v}`)} tabs={tabs}><span /></Tabs>
      <div className="mt-5">{tab === 'records' ? <Records /> : tab === 'codes' ? <Codes /> : <Queue />}</div>
    </>
  );
}

type QueueResp = Paged<AlumniRow> & { meta: Paged<AlumniRow>['meta'] & { counts: Record<'pending' | 'verified' | 'rejected', number> } };

function Queue() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [match, setMatch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ row: AlumniRow; action: 'approve' | 'reject' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dq = useDebounced(q);
  const params = { status, match, q: dq, page, page_size: 20 };
  const list = useQuery({ queryKey: ['admin-verification', params], queryFn: () => api<QueueResp>(`/api/v1/admin/verification${qs(params)}`), placeholderData: keepPreviousData });
  const bulk = useAction(() => api<{ data: { approved: number; skipped: { name?: string; reason: string }[] } }>('/api/v1/admin/verification/bulk-approve', { method: 'POST', body: { user_ids: [...selected] } }),
    { success: (r) => `${r.data.approved} member(s) verified.`, invalidate: [['admin-verification'], ['admin-alumni'], ['admin-dashboard']],
      onSuccess: (r) => { setSelected(new Set()); if (r.data.skipped.length) toast.error(`Skipped: ${r.data.skipped.map((s) => `${s.name ?? ''} — ${s.reason}`).join('; ')}`); } });
  const counts = list.data?.meta.counts;
  const rows = list.data?.data ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {(['pending', 'verified', 'rejected'] as const).map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); setSelected(new Set()); }} className="text-left" aria-pressed={status === s}>
            <StatTile icon={s === 'pending' ? ShieldCheck : s === 'verified' ? BadgeCheck : Ban} tone={s === 'pending' ? 'warning' : s === 'verified' ? 'success' : 'navy'}
              value={counts ? counts[s].toLocaleString() : '…'} label={`${VLABEL[s]}${status === s ? ' · showing' : ''}`} />
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search" placeholder="Name, email or registration number…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" />
          </div>
          <Select aria-label="School record match" value={match} onChange={(e) => { setMatch(e.target.value); setPage(1); }} className="md:w-56">
            <option value="">Any record match</option><option value="strong">Strong match</option><option value="partial">Partial match</option><option value="none">No matching record</option>
          </Select>
          {status === 'pending' && can('verification.approve') && selected.size > 0 && (
            <Button loading={bulk.isPending} onClick={() => bulk.mutate(undefined)}><BadgeCheck />Verify {selected.size} selected</Button>
          )}
        </div>
        <DataTable rows={rows} loading={list.isLoading} rowKey={(r) => r.id}
          empty={<EmptyState icon={ShieldCheck} title={status === 'pending' ? 'Queue is empty' : 'Nothing here'} description={status === 'pending' ? 'New registrations waiting for verification appear here.' : undefined} />}
          columns={[
            ...(status === 'pending' && can('verification.approve') ? [{ key: 'sel', header: <Checkbox checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
              onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} label={<span className="sr-only">Select all</span>} />,
              className: 'w-10', cell: (r: AlumniRow) => <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} label={<span className="sr-only">Select {r.full_name}</span>} /> }] : []),
            { key: 'name', header: 'Applicant', cell: (r) => (
              <button className="flex items-center gap-3 text-left" onClick={() => setOpen(r.id)}>
                <Avatar name={r.full_name} src={photoUrl(r.photo, 80)} size={36} />
                <div className="min-w-0"><p className="truncate font-medium text-primary hover:underline">{r.full_name}</p><p className="truncate text-xs text-ink-muted">{r.email}{!r.email_verified && ' · email unconfirmed'}</p></div>
              </button>) },
            { key: 'school', header: 'School details', cell: (r) => <div className="text-sm"><p>{r.batch ?? (r.graduation_year ? `Class of ${r.graduation_year}` : '—')}{r.kind === 'student' && <Badge className="ml-1">Student</Badge>}</p><p className="text-xs text-ink-muted">{r.registration_no ? `Reg. ${r.registration_no}` : 'No registration no.'}</p></div> },
            { key: 'match', header: 'Evidence', cell: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.match_strength === 'strong' ? <Badge tone="success">Record: strong match</Badge> : r.match_strength === 'partial' ? <Badge tone="warning">Record: partial match</Badge> : <Badge>No record match</Badge>}
                {r.documents > 0 && <Badge tone="primary"><FileText className="h-3 w-3" />{r.documents}</Badge>}
              </div>) },
            { key: 'when', header: status === 'pending' ? 'Waiting' : 'Updated', hideOnMobile: true, cell: (r) => <span className="text-ink-muted" title={fmtDateTime(r.submitted_at)}>{status === 'pending' ? timeAgo(r.submitted_at) : fmtDate(r.verified_at ?? r.submitted_at)}</span> },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (r) => r.verification_status === 'pending' && (
              <div className="flex justify-end gap-1">
                {can('verification.approve') && <Button size="sm" onClick={() => setDeciding({ row: r, action: 'approve' })}><Check />Verify</Button>}
                {can('verification.reject') && <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: r, action: 'reject' })}><X />Reject</Button>}
              </div>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {open && <AlumniDetailDialog id={open} onClose={() => setOpen(null)} canEdit={can('alumni.edit')} />}
      {deciding && <DecisionDialogLoader row={deciding.row} action={deciding.action} onClose={() => setDeciding(null)} />}
    </>
  );
}

/** Approval offers to link the matched record, so fetch it first. */
function DecisionDialogLoader({ row, action, onClose }: { row: AlumniRow; action: 'approve' | 'reject'; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-alumni-detail', row.id], queryFn: () => api<{ data: { record: null | { id: string; registration_no: string; full_name: string } } }>(`/api/v1/admin/alumni/${row.id}`), enabled: action === 'approve' && !!row.match_strength });
  if (action === 'approve' && row.match_strength && !q.data) return null;
  const record = q.data?.data.record as never;
  return <DecisionDialog d={{ ...row, record }} action={action} onClose={onClose} onDone={onClose} />;
}

// ── school records ──────────────────────────────────────────────────────────
type Rec = { id: string; registration_no: string; full_name: string; graduation_year: number | null; batch: string | null; email: string | null;
  phone: string | null; matched_user_id: string | null; member: string | null; invited_at: string | null; source: string; created_at: string };
type RecResp = Paged<Rec> & { meta: Paged<Rec>['meta'] & { summary: { records: number; matched: number; invited: number } } };
type ImportResult = { dry_run: boolean; created: number; updated: number; unchanged: number; error_count: number; errors: { row: number; message: string }[];
  new_batches: string[]; auto_verified?: number };

function Records() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const params = { q: dq, state, page, page_size: 25 };
  const list = useQuery({ queryKey: ['admin-records', params], queryFn: () => api<RecResp>(`/api/v1/admin/student-records${qs(params)}`), placeholderData: keepPreviousData });
  const invite = useAction((body: { ids?: string[]; all_uninvited?: boolean }) => api<{ data: { invited: number; skipped: unknown[] } }>('/api/v1/admin/student-records/invite', { method: 'POST', body }),
    { success: (r) => `${r.data.invited} invitation(s) sent${r.data.skipped.length ? `, ${r.data.skipped.length} skipped (existing accounts)` : ''}.`,
      invalidate: [['admin-records'], ['admin-alumni']], onSuccess: () => setSelected(new Set()) });
  const del = useAction((id: string) => api(`/api/v1/admin/student-records/${id}`, { method: 'DELETE' }), { success: 'Record deleted.', invalidate: [['admin-records']] });
  const s = list.data?.meta.summary;
  const rows = list.data?.data ?? [];
  const invitable = (r: Rec) => !r.matched_user_id && !!r.email;
  const canInvite = can('alumni.create') && can('verification.approve');
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile icon={FileSpreadsheet} value={s ? s.records.toLocaleString() : '…'} label="School records" />
        <StatTile icon={BadgeCheck} tone="success" value={s ? s.matched.toLocaleString() : '…'} label="Matched with members" />
        <StatTile icon={Mail} tone="navy" value={s ? s.invited.toLocaleString() : '…'} label="Invited" />
      </div>
      <Alert tone="info" className="mb-5" title="How records are used">
        Registrations with the same registration number, name and graduation year are matched to a record. They are verified automatically once the member proves the email or mobile number on that record; other matches are shown to you for review. Records with an email can also be invited directly.
      </Alert>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search records" placeholder="Name, registration number or email…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" />
          </div>
          <Select aria-label="State" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="lg:w-44">
            <option value="">All records</option><option value="unmatched">Not yet matched</option><option value="matched">Matched</option><option value="invited">Invited</option></Select>
          <div className="flex flex-wrap gap-2">
            {canInvite && selected.size > 0 && <Button loading={invite.isPending} onClick={() => invite.mutate({ ids: [...selected] })}><Mail />Invite {selected.size}</Button>}
            {canInvite && <Button variant="outline" onClick={async () => { if (await confirm({ title: 'Invite all uninvited records?', description: 'Every record with an email and no account (up to 500 at a time) gets a verified account and an invitation email.', confirmLabel: 'Send invitations' })) invite.mutate({ all_uninvited: true }); }}><Mail />Invite all</Button>}
            {can('alumni.create') && <Button onClick={() => setImporting(true)}><Upload />Import CSV</Button>}
          </div>
        </div>
        <DataTable rows={rows} loading={list.isLoading} rowKey={(r) => r.id}
          empty={<EmptyState icon={FileSpreadsheet} title="No school records yet" description="Import a CSV export of your student register to verify registrations automatically."
            action={can('alumni.create') && <Button onClick={() => setImporting(true)}><Upload />Import CSV</Button>} />}
          columns={[
            ...(canInvite ? [{ key: 'sel', className: 'w-10', header: <span className="sr-only">Select</span>, cell: (r: Rec) => invitable(r) && <Checkbox checked={selected.has(r.id)}
              onCheckedChange={() => setSelected((x) => { const n = new Set(x); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} label={<span className="sr-only">Select {r.full_name}</span>} /> }] : []),
            { key: 'reg', header: 'Registration no.', cell: (r) => <span className="font-mono text-[13px]">{r.registration_no}</span> },
            { key: 'name', header: 'Name', cell: (r) => <div><p className="font-medium">{r.full_name}</p><p className="text-xs text-ink-muted">{r.email ?? 'No email'}</p></div> },
            { key: 'class', header: 'Class', cell: (r) => r.batch ?? (r.graduation_year ? `Class of ${r.graduation_year}` : '—') },
            { key: 'state', header: 'Status', cell: (r) => r.member ? <Badge tone="success">Member: {r.member}</Badge> : r.invited_at ? <Badge tone="primary">Invited {fmtDate(r.invited_at)}</Badge> : <Badge>Not matched</Badge> },
            { key: 'src', header: 'Source', hideOnMobile: true, cell: (r) => <span className="text-xs text-ink-muted">{r.source}</span> },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right w-12', cell: (r) => can('alumni.delete') && (
              <Button size="icon" variant="ghost" aria-label={`Delete record ${r.registration_no}`} onClick={async () => { if (await confirm({ title: 'Delete this record?', description: 'Members already verified with it stay verified.', confirmLabel: 'Delete', danger: true })) del.mutate(r.id); }}><Trash2 /></Button>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [createBatches, setCreateBatches] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useAction((dry: boolean) => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('dry_run', String(dry));
    fd.append('create_batches', String(createBatches));
    return api<{ data: ImportResult }>('/api/v1/admin/student-records/import', { method: 'POST', body: fd });
  }, { invalidate: [['admin-records'], ['admin-verification'], ['admin-batches'], ['admin-batches-brief']], onSuccess: (r) => setResult(r.data) });
  const imported = result && !result.dry_run;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Import school records"
      description="CSV with a header row. Required: registration_no, full_name. Optional: father_name, date_of_birth, gender, admission_year, graduation_year, class_name, batch, email, phone."
      footer={imported ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {result?.dry_run && result.created + result.updated > 0
          ? <Button loading={run.isPending} onClick={() => run.mutate(false)}><Upload />Import {result.created + result.updated} record(s)</Button>
          : <Button loading={run.isPending} disabled={!file} onClick={() => run.mutate(true)}><Check />Check file</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => ref.current?.click()}><FileSpreadsheet />{file ? 'Choose another file' : 'Choose CSV file'}</Button>
          {file && <span className="text-sm text-ink">{file.name}</span>}
          <Button variant="link" size="sm" onClick={() => download('/api/v1/admin/student-records/template', 'student-records-template.csv')}><Download />Download template</Button>
          <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); e.target.value = ''; }} />
        </div>
        <Switch checked={createBatches} onCheckedChange={(v) => { setCreateBatches(v); setResult(null); }} label="Create missing batches" description="Batch names in the file that do not exist yet are created (needs a graduation year)." />
        {result && (
          <Alert tone={result.error_count ? 'warning' : 'success'} title={result.dry_run ? 'File checked — nothing saved yet' : 'Import complete'}>
            {result.created} new · {result.updated} updated · {result.unchanged} unchanged · {result.error_count} rejected
            {result.new_batches.length > 0 && <> · new batches: {result.new_batches.join(', ')}</>}
            {!result.dry_run && result.auto_verified ? <> · {result.auto_verified} waiting member(s) verified automatically</> : null}
          </Alert>
        )}
        {result && result.errors.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-card border border-line">
            <table className="w-full text-sm"><tbody className="divide-y divide-line">
              {result.errors.map((e) => <tr key={e.row}><td className="w-20 px-3 py-1.5 text-ink-muted">Row {e.row}</td><td className="px-3 py-1.5 text-danger">{e.message}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ── verification codes ──────────────────────────────────────────────────────
type Code = { id: string; label: string; hint: string; batch: string | null; max_uses: number; uses: number; expires_at: string | null;
  created_by: string | null; created_at: string; state: 'active' | 'used' | 'expired' | 'revoked' };
const CODE_TONE = { active: 'success', used: 'neutral', expired: 'neutral', revoked: 'danger' } as const;

function Codes() {
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['admin-codes', page], queryFn: () => api<Paged<Code>>(`/api/v1/admin/verification-codes${qs({ page })}`), placeholderData: keepPreviousData });
  const revoke = useAction((id: string) => api(`/api/v1/admin/verification-codes/${id}/revoke`, { method: 'POST' }), { success: 'Code revoked.', invalidate: [['admin-codes']] });
  return (
    <Card>
      <CardHeader title="Verification codes" icon={KeyRound}
        description="Hand codes out through an authorised process (reunion desk, batch coordinator, alumni office). Entering a valid code verifies the member."
        action={<Button onClick={() => setCreating(true)}><Plus />Issue codes</Button>} />
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(c) => c.id}
        empty={<EmptyState icon={KeyRound} title="No codes issued" description="Issue single-use codes for individuals or a multi-use code for an event." />}
        columns={[
          { key: 'label', header: 'Label', cell: (c) => <div><p className="font-medium">{c.label}</p><p className="font-mono text-xs text-ink-muted">…{c.hint}</p></div> },
          { key: 'batch', header: 'Batch', hideOnMobile: true, cell: (c) => c.batch ?? 'Any' },
          { key: 'uses', header: 'Used', cell: (c) => `${c.uses} / ${c.max_uses}` },
          { key: 'exp', header: 'Expires', hideOnMobile: true, cell: (c) => (c.expires_at ? fmtDate(c.expires_at) : 'Never') },
          { key: 'state', header: 'State', cell: (c) => <Badge tone={CODE_TONE[c.state]}>{c.state}</Badge> },
          { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (c) => c.state === 'active' && (
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Revoke this code?', confirmLabel: 'Revoke', danger: true })) revoke.mutate(c.id); }}><Ban />Revoke</Button>) },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      {creating && <IssueCodesDialog onClose={() => setCreating(false)} />}
    </Card>
  );
}

function IssueCodesDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const batches = useBatches();
  const [f, setF] = useState({ label: '', count: 1, max_uses: 1, expires_in_days: 30, batch_id: '' });
  const [codes, setCodes] = useState<string[] | null>(null);
  const run = useAction(() => api<{ data: { codes: string[] } }>('/api/v1/admin/verification-codes', { method: 'POST', body: { ...f, batch_id: f.batch_id || null } }),
    { invalidate: [['admin-codes']], onSuccess: (r) => setCodes(r.data.codes) });
  const e = run.fieldErrors;
  const text = codes?.join('\n') ?? '';
  if (codes) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()} title={`${codes.length} code(s) issued`} description="Copy or download them now — they are not shown again."
        footer={<>
          <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(text).then(() => toast.success('Copied.')).catch(() => toast.error('Copy failed — select and copy the codes manually.')); }}><Copy />Copy</Button>
          <Button variant="outline" onClick={() => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `verification-codes-${f.label.replace(/\W+/g, '-')}.txt` }); a.click(); }}><Download />Download</Button>
          <Button onClick={onClose}>Done</Button></>}>
        <pre className="max-h-72 overflow-y-auto rounded-card bg-canvas p-4 font-mono text-sm tracking-wider text-ink">{text}</pre>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Issue verification codes"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={run.isPending} disabled={f.label.trim().length < 2} onClick={() => run.mutate(undefined)}><KeyRound />Issue</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" required error={e.label} className="sm:col-span-2" hint="Who or what the codes are for, e.g. “Reunion 2026 desk”.">{(id, d) => <Input id={id} aria-describedby={d} value={f.label} onChange={(x) => setF({ ...f, label: x.target.value })} />}</Field>
        <Field label="Number of codes" error={e.count} hint="1–200">{(id) => <Input id={id} type="number" min={1} max={200} value={f.count} onChange={(x) => setF({ ...f, count: Number(x.target.value) })} />}</Field>
        <Field label="Uses per code" error={e.max_uses} hint="1 = personal code">{(id) => <Input id={id} type="number" min={1} max={1000} value={f.max_uses} onChange={(x) => setF({ ...f, max_uses: Number(x.target.value) })} />}</Field>
        <Field label="Valid for (days)" error={e.expires_in_days}>{(id) => <Input id={id} type="number" min={1} max={730} value={f.expires_in_days} onChange={(x) => setF({ ...f, expires_in_days: Number(x.target.value) })} />}</Field>
        <Field label="Only for batch" error={e.batch_id}>{(id) => <Select id={id} value={f.batch_id} onChange={(x) => setF({ ...f, batch_id: x.target.value })}>
          <option value="">Any batch</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

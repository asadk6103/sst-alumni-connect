import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Coins, Download, Eye, FileText, Gift, GraduationCap, HandHeart, ImagePlus, Images, Mail, Newspaper, Pencil, Plus, Send, Trash2, Upload,
  Users, X } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { fmtDate, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Skeleton, StatTile } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import { pick, type Img } from '@/pages/portal/Events';
import { fmtMoney, openReceipt, type CampaignT, type DonationT } from '@/pages/portal/Giving';

const CATS: [string, string][] = [['general', 'General donation'], ['scholarship', 'Scholarship fund'], ['sponsorship', 'Student sponsorship'],
  ['infrastructure', 'Infrastructure development'], ['library', 'Library development'], ['sports', 'Sports development'], ['emergency', 'Emergency assistance']];
async function uploadImage(file: File, folder: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('folder', folder);
  fd.append('images_only', 'true');
  return (await api<{ data: { id: string } }>('/api/v1/admin/media', { method: 'POST', body: fd })).data.id;
}

// ── donations ───────────────────────────────────────────────────────────────
type StaffDonation = DonationT & { donor_name: string; donor_email: string | null; payment_reference: string | null; notes: string | null };

export function DonationsAdminPage() {
  const { tab = 'overview' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Donations & Scholarships" description="Campaigns, pledges, confirmations, receipts and scholarship funds." />
      <Alert tone="info" className="mb-5" title="Online payments are not enabled">Donors pledge in the portal and pay by bank transfer, cash or cheque; confirm each payment here to issue the receipt.
        Bank details are set in System Configuration → Donations.</Alert>
      <Tabs value={tab} onValueChange={(v) => nav(v === 'overview' ? '/admin/donations' : `/admin/donations/${v}`)}
        tabs={[{ value: 'overview', label: 'Overview' }, { value: 'donations', label: 'Donations' }, { value: 'campaigns', label: 'Campaigns' },
          ...(can('scholarships.view') ? [{ value: 'scholarships', label: 'Scholarships' }] : [])]}><span /></Tabs>
      <div className="mt-5">{tab === 'donations' ? <DonationList /> : tab === 'campaigns' ? <CampaignList /> : tab === 'scholarships' ? <ScholarshipList /> : <Overview />}</div>
    </>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['donation-stats'], queryFn: () => get<{ total: number; count: number; donors: number; pledged_amount: number; pledged_count: number;
    by_category: { category: string; label: string; amount: number }[]; by_month: { month: string; amount: number }[] }>('/api/v1/admin/donations/stats') });
  const s = q.data;
  if (!s) return <Skeleton className="h-64 rounded-card" />;
  const max = Math.max(1, ...s.by_month.map((m) => m.amount));
  const maxCat = Math.max(1, ...s.by_category.map((c) => c.amount));
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile icon={Coins} value={fmtMoney(s.total, 'PKR')} label="Received" />
        <StatTile icon={HandHeart} tone="success" value={s.count} label="Donations" />
        <StatTile icon={Users} tone="navy" value={s.donors} label="Donors" />
        <StatTile icon={Gift} tone="warning" value={fmtMoney(s.pledged_amount, 'PKR')} label={`${s.pledged_count} pledges awaiting payment`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Received per month" />
          {!s.by_month.length ? <EmptyState icon={Coins} title="No donations yet" /> : (
            <div className="flex h-48 items-end gap-2 overflow-x-auto p-5" role="img" aria-label="Donations per month">{s.by_month.map((m) => (
              <div key={m.month} className="flex min-w-[30px] flex-1 flex-col items-center gap-1" title={`${m.month}: ${m.amount}`}>
                <div className="w-full max-w-[30px] rounded-t bg-primary/80" style={{ height: `${(m.amount / max) * 130 + 4}px` }} />
                <span className="text-[10px] text-ink-muted">{m.month.slice(2)}</span></div>))}</div>
          )}</Card>
        <Card><CardHeader title="By purpose" />
          <ul className="space-y-2.5 p-5">{s.by_category.map((c) => (
            <li key={c.category} className="grid grid-cols-[140px_1fr_90px] items-center gap-3 text-sm"><span className="truncate">{c.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-primary-soft"><span className="block h-full rounded-full bg-primary" style={{ width: `${(c.amount / maxCat) * 100}%` }} /></span>
              <span className="text-right tabular-nums text-ink-muted">{c.amount.toLocaleString()}</span></li>))}</ul></Card>
      </div>
    </div>
  );
}

function DonationList() {
  const { can } = useAuth();
  const [status, setStatus] = useState('pledged');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<StaffDonation | null>(null);
  const [recording, setRecording] = useState(false);
  const dq = useDebounced(q);
  const params = { status, q: dq, page };
  const list = useQuery({ queryKey: ['admin-donations', params], queryFn: () => api<Paged<StaffDonation & { campaign: DonationT['campaign'] }>>(`/api/v1/admin/donations${qs(params)}`), placeholderData: keepPreviousData });
  const confirm = useConfirm();
  const change = useAction(({ id, s }: { id: string; s: string }) => api(`/api/v1/admin/donations/${id}/status`, { method: 'POST', body: { status: s } }), { success: 'Updated.', invalidate: [['admin-donations'], ['donation-stats']] });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
        <Input aria-label="Search donations" placeholder="Donor, email, reference or receipt…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="md:max-w-sm" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-48">
          <option value="pledged">Awaiting payment</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option><option value="">All</option></Select>
        <div className="flex gap-2 md:ml-auto">
          {can('donations.export') && <Button variant="outline" onClick={() => download(`/api/v1/admin/donations/export${qs({ status })}`, 'donations.csv')}><Download />Export</Button>}
          {can('donations.create') && <Button onClick={() => setRecording(true)}><Plus />Record donation</Button>}
        </div>
      </div>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(d) => d.id} empty={<EmptyState icon={Gift} title="Nothing here" />}
        columns={[
          { key: 'who', header: 'Donor', cell: (d) => <div><p className="font-medium">{d.donor_name}{d.anonymous && <Badge className="ml-1">Anonymous</Badge>}</p><p className="text-xs text-ink-muted">{d.donor_email}</p></div> },
          { key: 'amount', header: 'Amount', cell: (d) => <span className="font-medium tabular-nums">{fmtMoney(d.amount, d.currency)}</span> },
          { key: 'for', header: 'For', hideOnMobile: true, cell: (d) => d.campaign?.title ?? d.category_label },
          { key: 'ref', header: 'Reference', cell: (d) => <div className="font-mono text-xs">{d.reference}{d.receipt_no && <p className="text-ink-muted">{d.receipt_no}</p>}</div> },
          { key: 'when', header: 'Date', hideOnMobile: true, cell: (d) => fmtDate(d.confirmed_at ?? d.created_at) },
          { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (d) => (
            <div className="flex justify-end gap-1">
              {d.status === 'pledged' && can('donations.edit') && <Button size="sm" onClick={() => setConfirming(d)}><Check />Confirm</Button>}
              {d.status === 'pledged' && can('donations.configure') && <Button size="sm" variant="ghost" onClick={() => change.mutate({ id: d.id, s: 'cancelled' })}><X /></Button>}
              {d.status === 'completed' && <Button size="sm" variant="outline" onClick={() => openReceipt(`/api/v1/admin/donations/${d.id}/receipt`)}><FileText />Receipt</Button>}
              {d.status === 'completed' && can('donations.configure') && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Mark as refunded?', description: 'The campaign total is reduced.', confirmLabel: 'Refunded', danger: true })) change.mutate({ id: d.id, s: 'refunded' }); }}>Refund</Button>}
            </div>) },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      {confirming && <ConfirmDialog d={confirming} onClose={() => setConfirming(null)} />}
      {recording && <RecordDialog onClose={() => setRecording(false)} />}
    </Card>
  );
}

function ConfirmDialog({ d, onClose }: { d: StaffDonation; onClose: () => void }) {
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const run = useAction(() => api(`/api/v1/admin/donations/${d.id}/confirm`, { method: 'POST', body: { payment_reference: ref || null, notes: notes || null } }),
    { success: 'Confirmed — the receipt was emailed to the donor.', invalidate: [['admin-donations'], ['donation-stats']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Confirm ${fmtMoney(d.amount, d.currency)} from ${d.donor_name}`} description={`Reference ${d.reference} · ${d.method.replace('_', ' ')}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={run.isPending} onClick={() => run.mutate(undefined)}><Check />Confirm and issue receipt</Button></>}>
      <div className="space-y-4">
        <Field label="Bank / cheque reference">{(id) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. transaction ID" />}</Field>
        <Field label="Internal notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />}</Field>
      </div>
    </Dialog>
  );
}

function RecordDialog({ onClose }: { onClose: () => void }) {
  const camps = useQuery({ queryKey: ['admin-campaigns'], queryFn: () => get<CampaignT[]>('/api/v1/admin/donations/campaigns') });
  const [f, setF] = useState({ donor_name: '', donor_email: '', campaign_id: '', category: 'general', amount: '', method: 'cash', payment_reference: '', anonymous: false, recognition_consent: false, notes: '' });
  const run = useAction(() => api('/api/v1/admin/donations', { method: 'POST', body: { ...f, donor_email: f.donor_email || null, campaign_id: f.campaign_id || null,
    payment_reference: f.payment_reference || null, notes: f.notes || null } }), { success: 'Donation recorded and receipt issued.', invalidate: [['admin-donations'], ['donation-stats'], ['admin-campaigns']], onSuccess: onClose });
  const e = run.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Record a donation received offline"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={run.isPending} disabled={!f.donor_name || !Number(f.amount)} onClick={() => run.mutate(undefined)}>Record</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Donor name" required error={e.donor_name}>{(id) => <Input id={id} value={f.donor_name} onChange={(x) => setF({ ...f, donor_name: x.target.value })} />}</Field>
        <Field label="Donor email" error={e.donor_email} hint="The receipt is emailed if the donor is a member.">{(id, d) => <Input id={id} aria-describedby={d} type="email" value={f.donor_email} onChange={(x) => setF({ ...f, donor_email: x.target.value })} />}</Field>
        <Field label="Campaign">{(id) => <Select id={id} value={f.campaign_id} onChange={(x) => setF({ ...f, campaign_id: x.target.value })}><option value="">— General —</option>{camps.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
        {!f.campaign_id ? <Field label="Purpose">{(id) => <Select id={id} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field> : <span />}
        <Field label="Amount" required error={e.amount}>{(id) => <Input id={id} type="number" min={1} value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} />}</Field>
        <Field label="Method">{(id) => <Select id={id} value={f.method} onChange={(x) => setF({ ...f, method: x.target.value })}><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></Select>}</Field>
        <Field label="Payment reference">{(id) => <Input id={id} value={f.payment_reference} onChange={(x) => setF({ ...f, payment_reference: x.target.value })} />}</Field>
        <Field label="Notes">{(id) => <Input id={id} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} />}</Field>
        <Checkbox checked={f.anonymous} onCheckedChange={(v) => setF({ ...f, anonymous: v })} label="Anonymous" />
        <Checkbox checked={f.recognition_consent} onCheckedChange={(v) => setF({ ...f, recognition_consent: v })} label="May be thanked on the donor wall" />
      </div>
    </Dialog>
  );
}

function CampaignList() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<(CampaignT & { pledged_amount?: number }) | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-campaigns'], queryFn: () => get<(CampaignT & { pledged_amount: number })[]>('/api/v1/admin/donations/campaigns') });
  const status = useAction(({ id, s }: { id: string; s: string }) => api(`/api/v1/admin/donations/campaigns/${id}/status`, { method: 'POST', body: { status: s } }), { success: 'Updated.', invalidate: [['admin-campaigns']] });
  return (
    <Card>
      <CardHeader title="Campaigns" icon={Gift} action={can('donations.create') && <Button size="sm" onClick={() => setEditing('new')}><Plus />New campaign</Button>} />
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(c) => c.id} empty={<EmptyState icon={Gift} title="No campaigns yet" />}
        columns={[
          { key: 't', header: 'Campaign', cell: (c) => <div className="max-w-xs"><p className="font-medium">{c.title}</p><p className="text-xs text-ink-muted">{c.category_label}</p></div> },
          { key: 'p', header: 'Progress', cell: (c) => <div className="w-48"><p className="text-sm">{fmtMoney(c.raised_amount, c.currency)}{c.goal_amount ? ` / ${fmtMoney(c.goal_amount, c.currency)}` : ''}</p>{c.progress !== null && <Progress value={c.progress} className="mt-1" />}
            {!!c.pledged_amount && <p className="text-xs text-ink-muted">+ {fmtMoney(c.pledged_amount, c.currency)} pledged</p>}</div> },
          { key: 's', header: 'Status', cell: (c) => <Badge tone={c.status === 'active' ? 'success' : c.status === 'draft' ? 'warning' : 'neutral'} className="capitalize">{c.status}</Badge> },
          { key: 'a', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (c) => can('donations.edit') && (
            <div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setEditing(c)}><Pencil />Edit</Button>
              {c.status !== 'active' ? <Button size="sm" onClick={() => status.mutate({ id: c.id, s: 'active' })}>Open</Button> : <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: c.id, s: 'closed' })}>Close</Button>}</div>) },
        ]} />
      {editing && <CampaignDialog c={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CampaignDialog({ c, onClose }: { c: CampaignT | null; onClose: () => void }) {
  const toast = useToast();
  const schol = useQuery({ queryKey: ['admin-scholarships'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/admin/scholarships') });
  const [f, setF] = useState({ title: c?.title ?? '', category: c?.category ?? 'general', summary: c?.summary ?? '', description: c?.description ?? '', image_id: c?.image?.id ?? null as string | null,
    goal_amount: c?.goal_amount ? String(c.goal_amount) : '', currency: c?.currency ?? 'PKR', starts_on: c?.starts_on ?? '', ends_on: c?.ends_on ?? '', scholarship_id: c?.scholarship_id ?? '' });
  const ref = useRef<HTMLInputElement>(null);
  const save = useAction(() => api(c ? `/api/v1/admin/donations/campaigns/${c.id}` : '/api/v1/admin/donations/campaigns', { method: c ? 'PUT' : 'POST', body: {
    ...f, goal_amount: f.goal_amount || null, starts_on: f.starts_on || null, ends_on: f.ends_on || null, scholarship_id: f.scholarship_id || null } }),
  { success: c ? 'Campaign saved.' : 'Campaign created as a draft — open it to accept donations.', invalidate: [['admin-campaigns']], onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={c ? 'Edit campaign' : 'New campaign'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => <Input id={id} value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <Field label="Purpose">{(id) => <Select id={id} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        {f.category === 'scholarship' ? <Field label="Scholarship fund">{(id) => <Select id={id} value={f.scholarship_id} onChange={(x) => setF({ ...f, scholarship_id: x.target.value })}><option value="">—</option>{schol.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field> : <span />}
        <Field label="Goal" error={e.goal_amount}>{(id) => <Input id={id} type="number" min={1} value={f.goal_amount} onChange={(x) => setF({ ...f, goal_amount: x.target.value })} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(x) => setF({ ...f, currency: x.target.value })}>{['PKR', 'USD', 'GBP', 'AED', 'SAR', 'EUR', 'CAD'].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
        <Field label="Starts">{(id) => <Input id={id} type="date" value={f.starts_on} onChange={(x) => setF({ ...f, starts_on: x.target.value })} />}</Field>
        <Field label="Ends" error={e.ends_on}>{(id) => <Input id={id} type="date" value={f.ends_on} onChange={(x) => setF({ ...f, ends_on: x.target.value })} />}</Field>
        <Field label="Summary" className="sm:col-span-2">{(id) => <Input id={id} value={f.summary} maxLength={300} onChange={(x) => setF({ ...f, summary: x.target.value })} />}</Field>
        <Field label="Description" hint="Use # headings, **bold**, - lists and links." className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} className="min-h-[140px]" />}</Field>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => ref.current?.click()}><ImagePlus />{f.image_id ? 'Change image' : 'Add image'}</Button>{f.image_id && <Badge tone="success">Image set</Badge>}
          <input ref={ref} type="file" accept="image/*" hidden onChange={async (x) => { const file = x.target.files?.[0]; x.target.value = ''; if (!file) return;
            try { setF({ ...f, image_id: await uploadImage(file, 'campaigns') }); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed.'); } }} /></div>
      </div>
    </Dialog>
  );
}

type ScholarshipT = { id: string; name: string; description: string; criteria: string; amount_per_award: number | null; currency: string; awards_per_year: number | null;
  sponsor_name: string | null; status: string; funds_raised: number; awards_count: number; awarded_amount: number };

function ScholarshipList() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<ScholarshipT | 'new' | null>(null);
  const [awarding, setAwarding] = useState<ScholarshipT | null>(null);
  const list = useQuery({ queryKey: ['admin-scholarships'], queryFn: () => get<ScholarshipT[]>('/api/v1/admin/scholarships') });
  return (
    <Card>
      <CardHeader title="Scholarship funds" icon={GraduationCap} action={<div className="flex gap-2">{can('scholarships.export') && <Button size="sm" variant="outline" onClick={() => download('/api/v1/admin/scholarships/export', 'scholarship-awards.csv')}><Download />Awards CSV</Button>}
        {can('scholarships.create') && <Button size="sm" onClick={() => setEditing('new')}><Plus />New scholarship</Button>}</div>} />
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(s) => s.id} empty={<EmptyState icon={GraduationCap} title="No scholarships yet" />}
        columns={[
          { key: 'n', header: 'Scholarship', cell: (s) => <div><p className="font-medium">{s.name}</p><p className="text-xs text-ink-muted">{s.sponsor_name ?? ''}</p></div> },
          { key: 'f', header: 'Raised', cell: (s) => fmtMoney(s.funds_raised, s.currency) },
          { key: 'a', header: 'Awarded', cell: (s) => `${s.awards_count} · ${fmtMoney(s.awarded_amount, s.currency)}` },
          { key: 's', header: 'Status', cell: (s) => <Badge tone={s.status === 'active' ? 'success' : 'neutral'} className="capitalize">{s.status}</Badge> },
          { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (s) => <div className="flex justify-end gap-1">
            {can('scholarships.create') && <Button size="sm" variant="outline" onClick={() => setAwarding(s)}><Gift />Awards</Button>}
            {can('scholarships.edit') && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil /></Button>}</div> },
        ]} />
      {editing && <ScholarshipDialog s={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {awarding && <AwardsDialog s={awarding} onClose={() => setAwarding(null)} />}
    </Card>
  );
}

function ScholarshipDialog({ s, onClose }: { s: ScholarshipT | null; onClose: () => void }) {
  const [f, setF] = useState({ name: s?.name ?? '', description: s?.description ?? '', criteria: s?.criteria ?? '', amount_per_award: s?.amount_per_award ? String(s.amount_per_award) : '',
    currency: s?.currency ?? 'PKR', awards_per_year: s?.awards_per_year ? String(s.awards_per_year) : '', sponsor_name: s?.sponsor_name ?? '', status: s?.status ?? 'active' });
  const save = useAction(() => api(s ? `/api/v1/admin/scholarships/${s.id}` : '/api/v1/admin/scholarships', { method: s ? 'PUT' : 'POST', body: {
    ...f, amount_per_award: f.amount_per_award || null, awards_per_year: f.awards_per_year ? Number(f.awards_per_year) : null, sponsor_name: f.sponsor_name || null } }),
  { success: 'Saved.', invalidate: [['admin-scholarships']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={s ? 'Edit scholarship' : 'New scholarship'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={save.fieldErrors.name} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} />}</Field>
        <Field label="Sponsor">{(id) => <Input id={id} value={f.sponsor_name} onChange={(x) => setF({ ...f, sponsor_name: x.target.value })} placeholder="e.g. Class of 2005" />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={f.status} onChange={(x) => setF({ ...f, status: x.target.value })}><option value="active">Active</option><option value="closed">Closed</option></Select>}</Field>
        <Field label="Amount per award">{(id) => <Input id={id} type="number" value={f.amount_per_award} onChange={(x) => setF({ ...f, amount_per_award: x.target.value })} />}</Field>
        <Field label="Awards per year">{(id) => <Input id={id} type="number" value={f.awards_per_year} onChange={(x) => setF({ ...f, awards_per_year: x.target.value })} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} />}</Field>
        <Field label="Eligibility criteria" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.criteria} onChange={(x) => setF({ ...f, criteria: x.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function AwardsDialog({ s, onClose }: { s: ScholarshipT; onClose: () => void }) {
  const list = useQuery({ queryKey: ['awards', s.id], queryFn: () => get<{ id: string; recipient_name: string; recipient_class: string | null; academic_year: string; amount: number; awarded_on: string }[]>(`/api/v1/admin/scholarships/${s.id}/awards`) });
  const [f, setF] = useState({ recipient_name: '', recipient_class: '', academic_year: `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`, amount: s.amount_per_award ? String(s.amount_per_award) : '', awarded_on: new Date().toISOString().slice(0, 10) });
  const add = useAction(() => api(`/api/v1/admin/scholarships/${s.id}/awards`, { method: 'POST', body: { ...f, recipient_class: f.recipient_class || null } }),
    { success: 'Award recorded.', invalidate: [['awards', s.id], ['admin-scholarships']], onSuccess: () => setF({ ...f, recipient_name: '', recipient_class: '' }) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={`Awards — ${s.name}`} description="Recipient details are visible to finance staff only.">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <Input aria-label="Recipient" placeholder="Recipient name" value={f.recipient_name} onChange={(x) => setF({ ...f, recipient_name: x.target.value })} className="sm:col-span-2" />
          <Input aria-label="Class" placeholder="Class" value={f.recipient_class} onChange={(x) => setF({ ...f, recipient_class: x.target.value })} />
          <Input aria-label="Academic year" value={f.academic_year} onChange={(x) => setF({ ...f, academic_year: x.target.value })} />
          <Input aria-label="Amount" type="number" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} />
        </div>
        <Button size="sm" loading={add.isPending} disabled={f.recipient_name.length < 2 || !Number(f.amount)} onClick={() => add.mutate(undefined)}><Plus />Record award</Button>
        {add.fieldErrors.academic_year && <p className="text-xs text-danger">Academic year like 2026-27.</p>}
        <ul className="divide-y divide-line rounded-card border border-line">{list.data?.map((a) => (
          <li key={a.id} className="flex justify-between px-4 py-2 text-sm"><span>{a.recipient_name}{a.recipient_class ? ` · ${a.recipient_class}` : ''} · {a.academic_year}</span>
            <span className="text-ink-muted">{fmtMoney(a.amount, s.currency)} · {fmtDate(a.awarded_on)}</span></li>))}
          {!list.data?.length && <li className="px-4 py-3 text-sm text-ink-muted">No awards yet.</li>}</ul>
      </div>
    </Dialog>
  );
}

// ── newsletters ─────────────────────────────────────────────────────────────
type NewsletterT = { id: string; subject: string; preheader: string; audience: string; batch_id: string | null; batch: string | null; status: string; scheduled_at: string | null;
  sent_at: string | null; recipient_count: number; created_at: string; body?: string; estimated_recipients?: number };

export function NewslettersAdminPage() {
  const [tab, setTab] = useState('issues');
  return (
    <>
      <PageHeader title="Newsletters" description="Compose issues, choose the audience and track subscribers." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'issues', label: 'Issues' }, { value: 'subscribers', label: 'Subscribers' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'subscribers' ? <Subscribers /> : <Issues />}</div>
    </>
  );
}

function Issues() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-newsletters'], queryFn: () => api<Paged<NewsletterT> & { meta: { subscribers: Record<string, number> } }>('/api/v1/admin/newsletters?page_size=50') });
  const TONE: Record<string, 'warning' | 'success' | 'primary' | 'neutral'> = { draft: 'warning', scheduled: 'primary', sending: 'primary', sent: 'success', cancelled: 'neutral' };
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile icon={Users} tone="success" value={list.data?.meta.subscribers.subscribed ?? 0} label="Subscribers (plus verified alumni)" />
        <StatTile icon={Mail} tone="warning" value={list.data?.meta.subscribers.pending ?? 0} label="Waiting for confirmation" />
        <StatTile icon={X} tone="navy" value={list.data?.meta.subscribers.unsubscribed ?? 0} label="Unsubscribed" />
      </div>
      <Card>
        <CardHeader title="Issues" icon={Newspaper} action={can('communications.create') && <Button size="sm" onClick={() => setEditing('new')}><Plus />New issue</Button>} />
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(n) => n.id} onRowClick={(n) => setEditing(n.id)} empty={<EmptyState icon={Newspaper} title="No newsletters yet" />}
          columns={[
            { key: 's', header: 'Subject', cell: (n) => <div><p className="font-medium">{n.subject}</p><p className="text-xs text-ink-muted">{n.audience === 'batch' ? n.batch : n.audience.replace('_', ' ')}</p></div> },
            { key: 'st', header: 'Status', cell: (n) => <Badge tone={TONE[n.status]} className="capitalize">{n.status}</Badge> },
            { key: 'r', header: 'Recipients', cell: (n) => n.recipient_count || '—' },
            { key: 'd', header: 'Date', hideOnMobile: true, cell: (n) => fmtDateTime(n.sent_at ?? n.scheduled_at ?? n.created_at) },
          ]} />
      </Card>
      {editing && <IssueEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function IssueEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const existing = useQuery({ queryKey: ['admin-newsletter', id], queryFn: () => get<NewsletterT>(`/api/v1/admin/newsletters/${id}`), enabled: !!id });
  if (id && !existing.data) return null;
  return <IssueForm n={existing.data} onClose={onClose} />;
}

function IssueForm({ n, onClose }: { n?: NewsletterT; onClose: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const batches = useQuery({ queryKey: ['admin-batches-brief'], queryFn: () => get<{ id: string; name: string }[]>('/api/v1/admin/batches') });
  const [f, setF] = useState({ subject: n?.subject ?? '', preheader: n?.preheader ?? '', body: n?.body ?? '', audience: n?.audience ?? 'all_subscribers', batch_id: n?.batch_id ?? '' });
  const [id, setId] = useState(n?.id ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const editable = !n || ['draft', 'scheduled'].includes(n.status);
  const body = { ...f, batch_id: f.audience === 'batch' ? f.batch_id || null : null };
  const save = useAction(() => api<{ data: NewsletterT }>(id ? `/api/v1/admin/newsletters/${id}` : '/api/v1/admin/newsletters', { method: id ? 'PUT' : 'POST', body }),
    { success: 'Saved.', invalidate: [['admin-newsletters']], onSuccess: (r) => setId(r.data.id) });
  const ensure = async () => (id ?? (await save.mutateAsync(undefined)).data.id);
  const showPreview = async () => { const nid = await ensure(); setPreview((await api<{ data: { html: string } }>(`/api/v1/admin/newsletters/${nid}/preview`, { method: 'POST' })).data.html); };
  const test = useAction(async () => api<{ data: { sent_to: string } }>(`/api/v1/admin/newsletters/${await ensure()}/test`, { method: 'POST' }), { success: (r) => `Test sent to ${r.data.sent_to}.` });
  const send = useAction(async () => api(`/api/v1/admin/newsletters/${await ensure()}/send`, { method: 'POST', body: { scheduled_at: when ? new Date(when).toISOString() : null } }),
    { success: when ? 'Scheduled.' : 'Sending — delivery runs in the background.', invalidate: [['admin-newsletters']], onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={n ? n.subject : 'New newsletter'} description={n?.estimated_recipients !== undefined ? `About ${n.estimated_recipients} recipients` : undefined}
      footer={editable ? <>
        <Button variant="outline" onClick={showPreview}><Eye />Preview</Button>
        <Button variant="outline" loading={test.isPending} onClick={() => test.mutate(undefined)}><Mail />Send me a test</Button>
        <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button>
        {can('communications.publish') && <Button loading={send.isPending} onClick={async () => { if (await confirm({ title: when ? 'Schedule this newsletter?' : 'Send this newsletter now?', description: 'Recipients who unsubscribed are always excluded.', confirmLabel: when ? 'Schedule' : 'Send' })) send.mutate(undefined); }}><Send />{when ? 'Schedule' : 'Send now'}</Button>}
      </> : <Button onClick={onClose}>Close</Button>}>
      {preview ? (
        <div><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>← Back to editing</Button>
          <iframe title="Newsletter preview" srcDoc={preview} sandbox="" className="mt-2 h-[60vh] w-full rounded-card border border-line bg-white" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {!editable && <Alert tone="success" className="sm:col-span-2">Sent {fmtDateTime(n?.sent_at)} to {n?.recipient_count} recipients.</Alert>}
          <Field label="Subject" required error={e.subject} className="sm:col-span-2">{(fid) => <Input id={fid} disabled={!editable} value={f.subject} onChange={(x) => setF({ ...f, subject: x.target.value })} />}</Field>
          <Field label="Preview text" hint="Shown by email apps next to the subject." className="sm:col-span-2">{(fid, d) => <Input id={fid} aria-describedby={d} disabled={!editable} value={f.preheader} onChange={(x) => setF({ ...f, preheader: x.target.value })} />}</Field>
          <Field label="Audience">{(fid) => <Select id={fid} disabled={!editable} value={f.audience} onChange={(x) => setF({ ...f, audience: x.target.value })}>
            <option value="all_subscribers">All subscribers + verified alumni</option><option value="verified_alumni">Verified alumni only</option><option value="batch">One batch</option></Select>}</Field>
          {f.audience === 'batch' ? <Field label="Batch" error={e.batch_id}>{(fid) => <Select id={fid} disabled={!editable} value={f.batch_id} onChange={(x) => setF({ ...f, batch_id: x.target.value })}><option value="">Choose…</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field> : <span />}
          <Field label="Content" required error={e.body} hint="# Heading, ## Subheading, **bold**, *italic*, - list item, [link](https://…). Paste links as they are." className="sm:col-span-2">
            {(fid, d) => <Textarea id={fid} aria-describedby={d} disabled={!editable} value={f.body} onChange={(x) => setF({ ...f, body: x.target.value })} className="min-h-[260px] font-mono text-[13px]" />}</Field>
          {editable && can('communications.publish') && <Field label="Schedule (optional)" hint="Leave empty to send immediately.">{(fid, d) => <Input id={fid} aria-describedby={d} type="datetime-local" value={when} onChange={(x) => setWhen(x.target.value)} />}</Field>}
        </div>
      )}
    </Dialog>
  );
}

function Subscribers() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('subscribed');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const ref = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['admin-subscribers', status, dq, page], queryFn: () => api<Paged<{ id: string; email: string; name: string | null; status: string; source: string; member: boolean; created_at: string }>>(`/api/v1/admin/newsletters/subscribers/list${qs({ status, q: dq, page })}`), placeholderData: keepPreviousData });
  const importCsv = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try { const r = await api<{ data: { added: number; skipped: number; errors: unknown[] } }>('/api/v1/admin/newsletters/subscribers/import', { method: 'POST', body: fd });
      toast.success(`${r.data.added} added, ${r.data.skipped} already known${r.data.errors.length ? `, ${r.data.errors.length} invalid rows` : ''}.`); list.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Import failed.'); }
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
        <Input aria-label="Search subscribers" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="md:max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-48"><option value="subscribed">Subscribed</option><option value="pending">Pending confirmation</option><option value="unsubscribed">Unsubscribed</option></Select>
        <div className="flex gap-2 md:ml-auto">
          <Button variant="outline" onClick={() => download('/api/v1/admin/newsletters/subscribers/export', 'subscribers.csv')}><Download />Export</Button>
          {can('communications.configure') && <Button variant="outline" onClick={() => ref.current?.click()}><Upload />Import CSV</Button>}
          <input ref={ref} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCsv(f); }} />
        </div>
      </div>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(s) => s.id} empty={<EmptyState icon={Users} title="No subscribers here" />}
        columns={[
          { key: 'e', header: 'Email', cell: (s) => <div><p className="font-medium">{s.email}</p><p className="text-xs text-ink-muted">{s.name}</p></div> },
          { key: 'src', header: 'Source', cell: (s) => <span className="capitalize">{s.source}{s.member && ' · member'}</span> },
          { key: 'd', header: 'Since', cell: (s) => fmtDate(s.created_at) },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

// ── gallery ─────────────────────────────────────────────────────────────────
type AdminAlbum = { id: string; title: string; description: string; cover: Img; cover_id: string | null; taken_on: string | null; visibility: string; status: string; photo_count: number;
  event: { id: string; title: string } | null; photos?: (NonNullable<Img> & { caption: string; media_id: string })[] };

export function GalleryAdminPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const list = useQuery({ queryKey: ['admin-albums'], queryFn: () => api<Paged<AdminAlbum>>('/api/v1/admin/gallery?page_size=60') });
  return (
    <>
      <PageHeader title="Gallery Management" description="Albums for members and the public website." actions={can('gallery.create') && <Button onClick={() => setOpen('new')}><Plus />New album</Button>} />
      {list.isLoading ? <Skeleton className="h-64 rounded-card" /> : !list.data?.data.length ? <Card><EmptyState icon={Images} title="No albums yet" /></Card> : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{list.data.data.map((a) => (
          <Card key={a.id} className="cursor-pointer overflow-hidden hover:shadow-pop" onClick={() => setOpen(a.id)}>
            <div className="aspect-[4/3] bg-canvas">{a.cover && <img src={pick(a.cover, 480)} alt="" className="h-full w-full object-cover" />}</div>
            <div className="p-3"><p className="truncate font-medium text-ink">{a.title}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Badge tone={a.status === 'published' ? 'success' : 'warning'}>{a.status}</Badge><Badge>{a.visibility}</Badge>{a.photo_count} photos</p></div>
          </Card>))}</div>
      )}
      {open && <AlbumEditor id={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </>
  );
}

function AlbumEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const [albumId, setAlbumId] = useState(id);
  const q = useQuery({ queryKey: ['admin-album', albumId], queryFn: () => get<AdminAlbum>(`/api/v1/admin/gallery/${albumId}`), enabled: !!albumId });
  const a = q.data;
  const [f, setF] = useState<{ title: string; description: string; visibility: string; taken_on: string } | null>(null);
  const form = f ?? { title: a?.title ?? '', description: a?.description ?? '', visibility: a?.visibility ?? 'members', taken_on: a?.taken_on ?? '' };
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const inv = [['admin-albums'], ['admin-album', albumId]];
  const save = useAction(() => api<{ data: AdminAlbum }>(albumId ? `/api/v1/admin/gallery/${albumId}` : '/api/v1/admin/gallery', { method: albumId ? 'PUT' : 'POST',
    body: { ...form, taken_on: form.taken_on || null, cover_id: a?.cover_id ?? null } }), { success: 'Album saved.', invalidate: inv, onSuccess: (r) => setAlbumId(r.data.id) });
  const publish = useAction((p: boolean) => api(`/api/v1/admin/gallery/${albumId}/publish`, { method: 'POST', body: { published: p } }), { success: 'Updated.', invalidate: inv });
  const remove = useAction((mid: string) => api(`/api/v1/admin/gallery/${albumId}/photos/${mid}`, { method: 'DELETE' }), { invalidate: inv });
  const cover = useAction((mid: string) => api(`/api/v1/admin/gallery/${albumId}`, { method: 'PUT', body: { ...form, taken_on: form.taken_on || null, cover_id: mid } }), { success: 'Cover set.', invalidate: inv });
  const del = useAction(() => api(`/api/v1/admin/gallery/${albumId}`, { method: 'DELETE' }), { success: 'Album deleted.', invalidate: [['admin-albums']], onSuccess: onClose });
  const upload = async (files: FileList | null) => {
    if (!albumId) return;
    setUploading(true);
    for (const file of Array.from(files ?? [])) {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/api/v1/admin/gallery/${albumId}/photos`, { method: 'POST', body: fd }).catch((e) => toast.error(e instanceof Error ? e.message : 'Upload failed.'));
    }
    setUploading(false);
    q.refetch();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={a?.title ?? 'New album'}
      footer={<>
        {albumId && can('gallery.delete') && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete this album?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}><Trash2 />Delete</Button>}
        <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
        {albumId && can('gallery.publish') && (a?.status === 'published' ? <Button variant="outline" onClick={() => publish.mutate(false)}>Unpublish</Button> : <Button onClick={() => publish.mutate(true)}><Send />Publish</Button>)}
      </>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required error={save.fieldErrors.title} className="sm:col-span-2">{(fid) => <Input id={fid} value={form.title} onChange={(x) => setF({ ...form, title: x.target.value })} />}</Field>
          <Field label="Date">{(fid) => <Input id={fid} type="date" value={form.taken_on} onChange={(x) => setF({ ...form, taken_on: x.target.value })} />}</Field>
          <Field label="Who can see it">{(fid) => <Select id={fid} value={form.visibility} onChange={(x) => setF({ ...form, visibility: x.target.value })}><option value="members">Members only</option><option value="public">Public website too</option></Select>}</Field>
          <Field label="Description" className="sm:col-span-2">{(fid) => <Textarea id={fid} value={form.description} onChange={(x) => setF({ ...form, description: x.target.value })} className="min-h-[60px]" />}</Field>
        </div>
        {!albumId ? <p className="text-sm text-ink-muted">Save the album, then add photos.</p> : (
          <>
            <Button variant="outline" loading={uploading} onClick={() => ref.current?.click()}><ImagePlus />Add photos</Button>
            <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(x) => { upload(x.target.files); x.target.value = ''; }} />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{a?.photos?.map((p) => (
              <div key={p.media_id} className="group relative"><img src={pick(p, 240)} alt="" className="aspect-square w-full rounded-btn object-cover" />
                {a.cover_id === p.media_id && <Badge tone="primary" className="absolute left-1 top-1">Cover</Badge>}
                <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => cover.mutate(p.media_id)} className="rounded bg-navy/80 px-1.5 py-0.5 text-[11px] text-white">Cover</button>
                  <button onClick={() => remove.mutate(p.media_id)} aria-label="Remove" className="rounded bg-danger/90 p-1 text-white"><Trash2 className="h-3 w-3" /></button></div>
              </div>))}</div>
          </>
        )}
      </div>
    </Dialog>
  );
}


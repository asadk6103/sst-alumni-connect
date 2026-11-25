import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, FileText, Gift, GraduationCap, HandHeart, Image as ImageIcon, Images, Receipt, Search, X } from 'lucide-react';
import { api, ApiError, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { pick, type Img } from './Events';

export type CampaignT = { id: string; slug: string; title: string; category: string; category_label: string; summary: string; image: Img; goal_amount: number | null;
  currency: string; raised_amount: number; donor_count: number; progress: number | null; starts_on: string | null; ends_on: string | null; status: string;
  scholarship_id: string | null; description?: string; description_html?: string; donors?: { name: string; message: string | null; at: string }[] };
export type DonationT = { id: string; reference: string; receipt_no: string | null; amount: number; currency: string; category: string; category_label: string;
  method: string; status: string; anonymous: boolean; recognition_consent: boolean; message: string | null; created_at: string; confirmed_at: string | null;
  campaign: { id: string; title: string; slug: string } | null };
type PayInfo = { bank: { bank_name: string; account_title: string; account_number: string; iban: string; branch: string } | null; other_methods: string;
  instructions: string; min_amount: number; online_available: boolean };

export const fmtMoney = (n: number, c: string) => `${c} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const STATUS_TONE: Record<string, 'warning' | 'success' | 'neutral' | 'danger'> = { pledged: 'warning', completed: 'success', cancelled: 'neutral', refunded: 'danger' };

export async function openReceipt(url: string) {
  const r = await api<Response>(url, { raw: true });
  const blob = new Blob([await r.text()], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

export function CampaignCard({ c }: { c: CampaignT }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={`/portal/donations/${c.id}`} className="block aspect-[16/8] bg-gradient-to-br from-primary to-navy">{c.image && <img src={pick(c.image, 800)} alt="" loading="lazy" className="h-full w-full object-cover" />}</Link>
      <div className="flex flex-1 flex-col p-4">
        <Badge tone="primary" className="w-fit">{c.category_label}</Badge>
        <Link to={`/portal/donations/${c.id}`} className="mt-2 font-heading font-semibold text-ink hover:text-primary">{c.title}</Link>
        {c.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{c.summary}</p>}
        <div className="mt-auto pt-4">
          {c.progress !== null && <Progress value={c.progress} label={`${c.progress}% funded`} />}
          <p className="mt-2 text-sm"><span className="font-semibold text-ink">{fmtMoney(c.raised_amount, c.currency)}</span>
            <span className="text-ink-muted">{c.goal_amount ? ` of ${fmtMoney(c.goal_amount, c.currency)}` : ' raised'} · {c.donor_count} donor{c.donor_count === 1 ? '' : 's'}</span></p>
        </div>
      </div>
    </Card>
  );
}

export function GivingPage() {
  const { tab = 'campaigns' } = useParams();
  const nav = useNavigate();
  const [giving, setGiving] = useState(false);
  return (
    <>
      <PageHeader title="Donations & Giving Back" description="Support scholarships, the library, sports and students in need."
        actions={<Button onClick={() => setGiving(true)}><HandHeart />Make a donation</Button>} />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'campaigns' ? '/portal/donations' : `/portal/donations/tab/${v}`)}
        tabs={[{ value: 'campaigns', label: 'Campaigns' }, { value: 'scholarships', label: 'Scholarships' }, { value: 'history', label: 'My donations' }]}><span /></Tabs>
      <div className="mt-5">{tab === 'history' ? <History /> : tab === 'scholarships' ? <Scholarships /> : <Campaigns />}</div>
      {giving && <DonateDialog onClose={() => setGiving(false)} />}
    </>
  );
}

function Campaigns() {
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => get<CampaignT[]>('/api/v1/donations/campaigns') });
  if (q.isLoading) return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-card" />)}</div>;
  if (!q.data?.length) return <Card><EmptyState icon={Gift} title="No active campaigns" description="You can still make a general donation." /></Card>;
  return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{q.data.map((c) => <CampaignCard key={c.id} c={c} />)}</div>;
}

export function CampaignPage() {
  const { id } = useParams();
  const [giving, setGiving] = useState(false);
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => get<CampaignT>(`/api/v1/donations/campaigns/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const c = q.data;
  if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (!c) return <Card><EmptyState icon={Gift} title="Campaign not found" /></Card>;
  return (
    <>
      <Link to="/portal/donations" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Donations</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="aspect-[16/7] bg-gradient-to-br from-primary to-navy">{c.image && <img src={pick(c.image, 1200)} alt="" className="h-full w-full object-cover" />}</div>
          <div className="p-6">
            <Badge tone="primary">{c.category_label}</Badge>
            <h1 className="mt-2 font-heading text-2xl font-semibold text-ink">{c.title}</h1>
            {c.summary && <p className="mt-1 text-ink-muted">{c.summary}</p>}
            {/* description_html is produced by the server's safe formatter (all input escaped first) */}
            {c.description_html && <div className="prose-sm mt-5 space-y-3 text-[15px] leading-relaxed text-ink [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: c.description_html }} />}
          </div>
        </Card>
        <aside className="space-y-5">
          <Card className="p-5">
            <p className="font-heading text-2xl font-semibold text-ink">{fmtMoney(c.raised_amount, c.currency)}</p>
            <p className="text-sm text-ink-muted">{c.goal_amount ? `raised of ${fmtMoney(c.goal_amount, c.currency)} goal` : 'raised so far'}</p>
            {c.progress !== null && <Progress value={c.progress} className="mt-3" label={`${c.progress}% funded`} />}
            <p className="mt-2 text-sm text-ink-muted">{c.donor_count} donor{c.donor_count === 1 ? '' : 's'}{c.ends_on ? ` · until ${fmtDate(c.ends_on)}` : ''}</p>
            {c.status === 'active' ? <Button className="mt-4 w-full" onClick={() => setGiving(true)}><HandHeart />Donate</Button> : <Alert tone="info" className="mt-4">This campaign is closed.</Alert>}
          </Card>
          {!!c.donors?.length && (
            <Card><CardHeader title="Thank you, donors" icon={Gift} />
              <ul className="max-h-80 divide-y divide-line overflow-y-auto">{c.donors.map((d, i) => (
                <li key={i} className="px-5 py-2.5 text-sm"><span className="font-medium text-ink">{d.name}</span>{d.message && <span className="block text-xs text-ink-muted">“{d.message}”</span>}</li>))}</ul>
            </Card>
          )}
        </aside>
      </div>
      {giving && <DonateDialog campaign={c} onClose={() => setGiving(false)} />}
    </>
  );
}

function DonateDialog({ campaign, onClose }: { campaign?: CampaignT; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const info = useQuery({ queryKey: ['payment-info'], queryFn: () => get<PayInfo>('/api/v1/donations/payment-info') });
  const camps = useQuery({ queryKey: ['campaigns'], queryFn: () => get<CampaignT[]>('/api/v1/donations/campaigns'), enabled: !campaign });
  const [f, setF] = useState({ campaign_id: campaign?.id ?? '', category: 'general', amount: '', method: 'bank_transfer', anonymous: false, recognition_consent: true, message: '' });
  const [done, setDone] = useState<(DonationT & { payment_info: PayInfo }) | null>(null);
  const currency = campaign?.currency ?? camps.data?.find((c) => c.id === f.campaign_id)?.currency ?? 'PKR';
  const pledge = useAction(() => api<{ data: DonationT & { payment_info: PayInfo } }>('/api/v1/donations/pledges', { method: 'POST', body: {
    ...f, campaign_id: f.campaign_id || null, amount: f.amount, message: f.message || null } }),
  { invalidate: [['my-donations'], ['campaign']], onSuccess: (r) => setDone(r.data) });
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied.')).catch(() => undefined);
  if (!can('portal.donate')) return <Dialog open onOpenChange={(v) => !v && onClose()} title="Make a donation"><Alert tone="info">Donations through the portal are open to members.</Alert></Dialog>;
  if (done) {
    const b = done.payment_info.bank;
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()} title="Thank you for your pledge!" description="Please complete the payment using these details."
        footer={<><Button variant="outline" onClick={() => { onClose(); nav('/portal/donations/tab/history'); }}>My donations</Button><Button onClick={onClose}>Done</Button></>}>
        <div className="space-y-4 text-sm">
          <div className="rounded-card bg-primary-soft/60 p-4 text-center"><p className="text-ink-muted">Amount</p><p className="font-heading text-2xl font-semibold text-ink">{fmtMoney(done.amount, done.currency)}</p>
            <p className="mt-2 text-ink-muted">Your reference</p><button className="inline-flex items-center gap-1 font-mono text-lg font-semibold text-primary" onClick={() => copy(done.reference)}>{done.reference}<Copy className="h-4 w-4" /></button></div>
          {b && <dl className="grid grid-cols-[120px_1fr] gap-y-1.5"><dt className="text-ink-muted">Bank</dt><dd>{b.bank_name}</dd><dt className="text-ink-muted">Account title</dt><dd>{b.account_title}</dd>
            {b.iban && <><dt className="text-ink-muted">IBAN</dt><dd><button className="inline-flex items-center gap-1 font-mono" onClick={() => copy(b.iban)}>{b.iban}<Copy className="h-3.5 w-3.5" /></button></dd></>}
            {b.account_number && <><dt className="text-ink-muted">Account no.</dt><dd className="font-mono">{b.account_number}</dd></>}{b.branch && <><dt className="text-ink-muted">Branch</dt><dd>{b.branch}</dd></>}</dl>}
          <Alert tone="info">{done.payment_info.instructions}</Alert>
          {done.payment_info.other_methods && <p className="text-ink-muted">{done.payment_info.other_methods}</p>}
          <p className="text-xs text-ink-muted">We email your receipt as soon as the payment reaches us. These details were also sent to your email.</p>
        </div>
      </Dialog>
    );
  }
  const presets = [1000, 5000, 10000, 25000];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={campaign ? `Donate to ${campaign.title}` : 'Make a donation'}
      description="Online card payments are not enabled — you pledge here and pay by bank transfer, cash or cheque."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={pledge.isPending} disabled={!Number(f.amount)} onClick={() => pledge.mutate(undefined)}><HandHeart />Pledge {f.amount ? fmtMoney(Number(f.amount), currency) : ''}</Button></>}>
      <div className="space-y-4">
        {!campaign && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign">{(id) => <Select id={id} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">General donation</option>{camps.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
            {!f.campaign_id && <Field label="Purpose">{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {[['general', 'General donation'], ['scholarship', 'Scholarship fund'], ['sponsorship', 'Student sponsorship'], ['infrastructure', 'Infrastructure'], ['library', 'Library'], ['sports', 'Sports'], ['emergency', 'Emergency assistance']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>}
          </div>
        )}
        <Field label={`Amount (${currency})`} required error={pledge.fieldErrors.amount} hint={info.data ? `Minimum ${fmtMoney(info.data.min_amount, currency)}` : undefined}>{(id, d) => (<>
          <div className="mb-2 flex flex-wrap gap-2">{presets.map((p) => <button key={p} type="button" onClick={() => setF({ ...f, amount: String(p) })}
            className={cn('rounded-btn border px-3 py-1.5 text-sm', Number(f.amount) === p ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line hover:bg-canvas')}>{p.toLocaleString()}</button>)}</div>
          <Input id={id} aria-describedby={d} type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="Other amount" /></>)}</Field>
        <Field label="How will you pay?">{(id) => <Select id={id} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash at the alumni office</option><option value="cheque">Cheque</option></Select>}</Field>
        <Field label="Message (optional)">{(id) => <Textarea id={id} value={f.message} maxLength={500} onChange={(e) => setF({ ...f, message: e.target.value })} className="min-h-[60px]" />}</Field>
        <div className="space-y-2">
          <Checkbox checked={f.anonymous} onCheckedChange={(v) => setF({ ...f, anonymous: v })} label="Give anonymously (your name is not shown to other members)" />
          <Checkbox checked={f.recognition_consent} onCheckedChange={(v) => setF({ ...f, recognition_consent: v })} label="Thank me on the campaign's donor wall" />
        </div>
      </div>
    </Dialog>
  );
}

function History() {
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['my-donations'], queryFn: () => api<{ data: DonationT[]; meta: { total_given: number } }>('/api/v1/donations/mine') });
  const cancel = useAction((id: string) => api(`/api/v1/donations/${id}/cancel`, { method: 'POST' }), { success: 'Pledge cancelled.', invalidate: [['my-donations']] });
  return (
    <Card>
      <CardHeader title="My donations" icon={Receipt} description={q.data?.meta.total_given ? `Thank you — you have given ${fmtMoney(q.data.meta.total_given, q.data.data[0]?.currency ?? 'PKR')}.` : undefined} />
      {q.isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !q.data?.data.length ? <EmptyState icon={Gift} title="No donations yet" /> : (
        <ul className="divide-y divide-line">{q.data.data.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="font-medium text-ink">{fmtMoney(d.amount, d.currency)} · {d.campaign?.title ?? d.category_label}</p>
              <p className="text-xs text-ink-muted">Ref {d.reference} · {fmtDate(d.created_at)}{d.receipt_no ? ` · Receipt ${d.receipt_no}` : ''}</p></div>
            <Badge tone={STATUS_TONE[d.status]} className="capitalize">{d.status === 'pledged' ? 'Awaiting payment' : d.status}</Badge>
            {d.status === 'completed' && <Button size="sm" variant="outline" onClick={() => openReceipt(`/api/v1/donations/${d.id}/receipt`)}><FileText />Receipt</Button>}
            {d.status === 'pledged' && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Cancel this pledge?', confirmLabel: 'Cancel pledge', danger: true })) cancel.mutate(d.id); }}><X />Cancel</Button>}
          </li>))}</ul>
      )}
    </Card>
  );
}

function Scholarships() {
  const q = useQuery({ queryKey: ['scholarships'], queryFn: () => get<{ id: string; name: string; description: string; criteria: string; amount_per_award: number | null; currency: string;
    sponsor_name: string | null; funds_raised: number; awards_count: number; campaign: { id: string; title: string } | null }[]>('/api/v1/scholarships') });
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!q.data?.length) return <Card><EmptyState icon={GraduationCap} title="No scholarships yet" /></Card>;
  return (
    <div className="grid gap-5 md:grid-cols-2">{q.data.map((s) => (
      <Card key={s.id} className="p-5">
        <p className="flex items-center gap-2 font-heading font-semibold text-ink"><GraduationCap className="h-5 w-5 text-primary" />{s.name}</p>
        {s.sponsor_name && <p className="text-xs text-ink-muted">Sponsored by {s.sponsor_name}</p>}
        {s.description && <p className="mt-2 text-sm text-ink">{s.description}</p>}
        {s.criteria && <p className="mt-2 text-xs text-ink-muted"><strong>Criteria:</strong> {s.criteria}</p>}
        <p className="mt-3 text-sm text-ink-muted">{s.awards_count} award{s.awards_count === 1 ? '' : 's'} given{s.amount_per_award ? ` · ${fmtMoney(s.amount_per_award, s.currency)} each` : ''}</p>
        {s.campaign && <Button asChild size="sm" className="mt-3"><Link to={`/portal/donations/${s.campaign.id}`}><HandHeart />Sponsor this scholarship</Link></Button>}
      </Card>))}</div>
  );
}

// ── gallery ─────────────────────────────────────────────────────────────────
type AlbumT = { id: string; title: string; description: string; cover: Img; taken_on: string | null; visibility: string; status: string; photo_count: number;
  event: { id: string; title: string } | null; photos?: (NonNullable<Img> & { caption: string; media_id: string })[] };

export function GalleryPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['albums', dq, page], queryFn: () => api<Paged<AlbumT>>(`/api/v1/gallery/albums${qs({ q: dq, page, page_size: 12 })}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Gallery" description="Reunions, events and memories from the SST community."
        actions={<div className="relative w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input aria-label="Search albums" placeholder="Search albums…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>} />
      {list.isLoading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-card" />)}</div>
        : !list.data?.data.length ? <Card><EmptyState icon={Images} title="No albums yet" /></Card> : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.data.data.map((a) => (
            <Link key={a.id} to={`/portal/gallery/${a.id}`} className="group block"><Card className="overflow-hidden">
              <div className="aspect-[4/3] bg-canvas">{a.cover ? <img src={pick(a.cover, 800)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /> : <ImageIcon className="m-auto h-full w-10 text-ink-muted" />}</div>
              <div className="p-4"><p className="font-heading font-semibold text-ink group-hover:text-primary">{a.title}</p><p className="text-xs text-ink-muted">{a.photo_count} photos{a.taken_on ? ` · ${fmtDate(a.taken_on)}` : ''}</p></div>
            </Card></Link>))}</div>
        )}
      {list.data && list.data.meta.pages > 1 && <Card className="mt-5"><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>}
    </>
  );
}

export function AlbumPage() {
  const { id } = useParams();
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['album', id], queryFn: () => get<AlbumT>(`/api/v1/gallery/albums/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const a = q.data;
  const photos = a?.photos ?? [];
  return (
    <>
      <Link to="/portal/gallery" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Gallery</Link>
      {q.isLoading ? <Skeleton className="h-96 rounded-card" /> : !a ? <Card><EmptyState icon={Images} title="Album not found" /></Card> : (
        <>
          <PageHeader title={a.title} description={[a.description, a.event && `From ${a.event.title}`].filter(Boolean).join(' · ')} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{photos.map((p, i) => (
            <button key={p.media_id} onClick={() => setOpen(i)} className="group overflow-hidden rounded-card"><img src={pick(p, 480)} alt={p.caption || p.alt} loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-105" /></button>))}</div>
          {open !== null && photos[open] && (
            <Dialog open onOpenChange={(v) => !v && setOpen(null)} wide title={photos[open]!.caption || `Photo ${open + 1} of ${photos.length}`}
              footer={<><Button variant="outline" onClick={() => setOpen((open + photos.length - 1) % photos.length)}>Previous</Button><Button variant="outline" onClick={() => setOpen((open + 1) % photos.length)}>Next</Button></>}>
              <img src={pick(photos[open]!, 1920)} alt={photos[open]!.caption} className="mx-auto max-h-[70vh]" />
            </Dialog>
          )}
        </>
      )}
    </>
  );
}


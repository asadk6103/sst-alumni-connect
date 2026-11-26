import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldAlert, Trash2, UserX } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, PasswordInput, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';

type Req = { id: string; kind: string; status: 'pending' | 'completed' | 'rejected' | 'cancelled'; reason: string | null; admin_note: string | null;
  created_at: string; handled_at: string | null; user?: { id: string; full_name: string; email: string } };

/** Account settings → Your data: download a copy, ask for deletion. */
export function PrivacySection() {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const req = useQuery({ queryKey: ['deletion-request'], queryFn: () => get<Req | null>('/api/v1/account/deletion-request') });
  const cancel = useAction(() => api('/api/v1/account/deletion-request', { method: 'DELETE' }), { success: 'Request withdrawn.', invalidate: [['deletion-request']] });
  const r = req.data;
  return (
    <>
      <Card>
        <CardHeader title="Download your data" icon={Download} description="A copy of everything the portal stores about you — profile, network, posts, messages you sent, registrations, applications and donations — as a JSON file." />
        <div className="p-5"><Button variant="outline" loading={busy} onClick={async () => { setBusy(true); try { await download('/api/v1/account/export', 'my-data.json'); } finally { setBusy(false); } }}><Download />Download my data</Button></div>
      </Card>
      <Card>
        <CardHeader title="Delete your account" icon={UserX} description="The alumni office reviews deletion requests. Your profile, contact details, network and files are erased; posts and messages remain as “Deleted member”; donation records are kept without your name for the institution's accounts." />
        <div className="space-y-3 p-5">
          {r?.status === 'pending' && <Alert tone="warning" title="Deletion requested">Sent {fmtDateTime(r.created_at)}. The alumni office will handle it soon.
            <div className="mt-2"><Button size="sm" variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Withdraw request</Button></div></Alert>}
          {r?.status === 'rejected' && <Alert tone="info" title="Your last request was declined">{r.admin_note}</Alert>}
          {r?.status !== 'pending' && <Button variant="outline" className="text-danger" onClick={() => setAsking(true)}><Trash2 />Request account deletion</Button>}
        </div>
      </Card>
      {asking && <DeletionDialog onClose={() => setAsking(false)} />}
    </>
  );
}

export function DeletionDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const send = useAction(() => api('/api/v1/account/deletion-request', { method: 'POST', body: { password, reason: reason || null } }),
    { success: 'Request sent to the alumni office.', invalidate: [['deletion-request']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Request account deletion" description="This cannot be undone once the alumni office completes it."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={send.isPending} disabled={!password} onClick={() => send.mutate(undefined)}><Trash2 />Send request</Button></>}>
      <div className="space-y-4">
        <Field label="Reason (optional)">{(id) => <Textarea id={id} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} className="min-h-[70px]" />}</Field>
        <Field label="Confirm with your password" required error={send.fieldErrors.password}>{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/** Administration → Privacy requests. */
export function PrivacyAdminPage() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['privacy-requests', status, page], queryFn: () => api<Paged<Req>>(`/api/v1/admin/privacy/requests${qs({ status, page })}`) });
  const approve = useAction((id: string) => api(`/api/v1/admin/privacy/requests/${id}/approve`, { method: 'POST', body: {} }), { success: 'Account deleted (anonymised).', invalidate: [['privacy-requests']] });
  return (
    <>
      <PageHeader title="Privacy requests" description="Members' requests to delete their accounts. Members download their own data from Account settings." />
      <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} tabs={[{ value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' }, { value: 'rejected', label: 'Declined' }, { value: 'cancelled', label: 'Withdrawn' }]}><span /></Tabs>
      <Card className="mt-5">
        {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.data.length ? <EmptyState icon={ShieldAlert} title="No requests" /> : (
          <ul className="divide-y divide-line">
            {list.data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{r.user?.full_name} <span className="font-normal text-ink-muted">· {r.user?.email}</span></p>
                  <p className="text-xs text-ink-muted">Requested {fmtDateTime(r.created_at)}{r.handled_at ? ` · handled ${fmtDateTime(r.handled_at)}` : ''}</p>
                  {r.reason && <p className="mt-1 text-sm text-ink">“{r.reason}”</p>}
                  {r.admin_note && <p className="mt-1 text-sm text-ink-muted">Note: {r.admin_note}</p>}
                </div>
                {r.status === 'pending' ? <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>Decline</Button>
                  <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: `Delete ${r.user?.full_name}'s account?`, description: 'Profile, contact details, network and files are erased and the person is signed out everywhere. This cannot be undone.', danger: true, confirmLabel: 'Delete account' })) approve.mutate(r.id); }}>Delete account</Button>
                </div> : <Badge tone={r.status === 'completed' ? 'success' : 'neutral'}>{r.status}</Badge>}
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {rejecting && <RejectDialog r={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}

function RejectDialog({ r, onClose }: { r: Req; onClose: () => void }) {
  const [note, setNote] = useState('');
  const reject = useAction(() => api(`/api/v1/admin/privacy/requests/${r.id}/reject`, { method: 'POST', body: { note } }), { success: 'Request declined.', invalidate: [['privacy-requests']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Decline the request" description="The member sees this explanation."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={reject.isPending} disabled={!note.trim()} onClick={() => reject.mutate(undefined)}>Decline</Button></>}>
      <Field label="Reason" required>{(id) => <Textarea id={id} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Dialog>
  );
}

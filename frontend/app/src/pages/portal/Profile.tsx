import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Flag, MoreHorizontal, UserX } from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import type { ProfileDetail } from '@/lib/alumni';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from '@/components/ui/overlay';
import { NoAccess, ProfileBody, RelationActions } from '@/components/alumni';

const MessageButton = lazy(() => import('./Messages').then((m) => ({ default: m.MessageButton })));

export function ProfileViewPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [reporting, setReporting] = useState(false);
  const q = useQuery({ queryKey: ['alumni-profile', id], queryFn: () => get<ProfileDetail>(`/api/v1/alumni/profiles/${id}`),
    enabled: can('portal.directory') && id !== user?.id, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const remove = useAction(() => api(`/api/v1/alumni/connections/${q.data!.connection_id}`, { method: 'DELETE' }),
    { success: 'Connection removed.', invalidate: [['alumni-profile'], ['connections']] });
  if (id === user?.id) return <Navigate to="/portal/profile" replace />;
  if (!can('portal.directory')) return <NoAccess />;
  const back = <button onClick={() => nav(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</button>;
  if (q.isLoading) return <>{back}<Skeleton className="h-56 rounded-card" /><Skeleton className="mt-5 h-72 rounded-card" /></>;
  if (!q.data) {
    return <>{back}<Card><EmptyState icon={UserX} title="Profile not available" description="This profile does not exist or its owner has made it private."
      action={<Button asChild variant="outline"><Link to="/portal/directory">Back to the directory</Link></Button>} /></Card></>;
  }
  const p = q.data;
  return (
    <>
      {back}
      <ProfileBody p={p} actions={
        <div className="flex items-center gap-2">
          <RelationActions p={p} />
          {p.connection === 'accepted' && <Suspense fallback={null}><MessageButton userId={p.id} /></Suspense>}
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              {p.connection === 'accepted' && <MenuItem onSelect={async () => { if (await confirm({ title: 'Remove connection', description: `You and ${p.full_name} will no longer be connected.`, confirmLabel: 'Remove', danger: true })) remove.mutate(undefined); }}><UserX />Remove connection</MenuItem>}
              <MenuItem danger onSelect={() => setReporting(true)}><Flag />Report profile</MenuItem>
            </MenuContent>
          </Menu>
        </div>} />
      {reporting && <ReportDialog id={p.id} name={p.full_name} onClose={() => setReporting(false)} />}
    </>
  );
}

function ReportDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [reason, setReason] = useState('fake');
  const [details, setDetails] = useState('');
  const send = useAction(() => api(`/api/v1/alumni/profiles/${id}/report`, { method: 'POST', body: { reason, details: details || null } }),
    { success: 'Thank you. The administrators will review this profile.', onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Report ${name}`} description="Reports are confidential; the member is not told who reported them."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={send.isPending} onClick={() => send.mutate(undefined)}><Flag />Send report</Button></>}>
      <div className="space-y-4">
        <Field label="Reason">{(fid) => <Select id={fid} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="fake">Fake profile</option><option value="impersonation">Pretending to be someone else</option>
          <option value="inappropriate">Inappropriate content</option><option value="spam">Spam</option><option value="other">Something else</option></Select>}</Field>
        <Field label="Details" hint="Optional, up to 1000 characters." error={send.fieldErrors.details}>{(fid, d) => <Textarea id={fid} aria-describedby={d} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

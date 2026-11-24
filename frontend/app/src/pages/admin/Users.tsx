import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, KeyRound, LogOut, MoreHorizontal, Pencil, Plus, Search, ShieldOff, Trash2, Unlock, Users as UsersIcon } from 'lucide-react';
import { api, download, get, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, PageHeader } from '@/components/ui/display';
import { Checkbox, Field, Input, PasswordInput, Select } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';

export type AdminUser = {
  id: string; email: string; full_name: string; phone: string | null; status: string; email_verified: boolean; mfa_enabled: boolean;
  locked: boolean; roles: { key: string; name: string }[]; last_login_at: string | null; created_at: string;
};
type Role = { key: string; name: string; is_staff: boolean };

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { active: 'success', pending: 'warning', deactivated: 'neutral' };

export function UsersPage() {
  const { can, user: me } = useAuth();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, status, role, page, page_size: 20 };
  const list = useQuery({ queryKey: ['admin-users', params], queryFn: () => api<Paged<AdminUser>>(`/api/v1/admin/users${qs(params)}`), placeholderData: keepPreviousData });
  const roles = useQuery({ queryKey: ['roles-brief'], queryFn: () => get<Role[]>('/api/v1/admin/roles'), enabled: can('roles.view') });

  const act = useAction(({ id, action }: { id: string; action: string }) =>
    action === 'delete' ? api(`/api/v1/admin/users/${id}`, { method: 'DELETE' }) : api(`/api/v1/admin/users/${id}/${action}`, { method: 'POST' }),
  { success: 'Done.', invalidate: [['admin-users']] });

  const run = async (u: AdminUser, action: string, title: string, description: string, danger = false) => {
    if (await confirm({ title, description, confirmLabel: title.split(' ')[0], danger })) act.mutate({ id: u.id, action });
  };

  return (
    <>
      <PageHeader title="User Management" description="Accounts, roles and access."
        actions={<>
          {can('users.export') && <Button variant="outline" onClick={() => download(`/api/v1/admin/users/export${qs({ q: dq, status, role })}`, 'users.csv')}><Download />Export CSV</Button>}
          {can('users.create') && <Button onClick={() => setEditing('new')}><Plus />Add user</Button>}
        </>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search users" placeholder="Search by name, email or phone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-44">
            <option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending verification</option><option value="deactivated">Deactivated</option>
          </Select>
          {roles.data && (
            <Select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="md:w-56">
              <option value="">All roles</option>{roles.data.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          )}
        </div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(u) => u.id}
          empty={<EmptyState icon={UsersIcon} title="No users found" description={q || status || role ? 'Try a different search or filter.' : 'Add the first user to get started.'} />}
          columns={[
            { key: 'name', header: 'User', cell: (u) => (
              <div className="flex items-center gap-3">
                <Avatar name={u.full_name} size={34} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.full_name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-ink-muted">(you)</span>}</p>
                  <p className="truncate text-xs text-ink-muted">{u.email}</p>
                </div>
              </div>) },
            { key: 'roles', header: 'Roles', cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.key} tone={r.key === 'super_admin' ? 'navy' : 'primary'}>{r.name}</Badge>)}</div> },
            { key: 'status', header: 'Status', cell: (u) => (
              <div className="flex flex-wrap gap-1">
                <Badge tone={STATUS_TONE[u.status] ?? 'neutral'}>{u.status === 'pending' ? 'Pending' : u.status[0]!.toUpperCase() + u.status.slice(1)}</Badge>
                {u.locked && <Badge tone="danger">Locked</Badge>}
                {u.mfa_enabled && <Badge tone="success">2FA</Badge>}
              </div>) },
            { key: 'login', header: 'Last sign-in', hideOnMobile: true, cell: (u) => <span title={fmtDateTime(u.last_login_at)} className="text-ink-muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</span> },
            { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: (u) => (can('users.edit') || can('users.delete')) && (
              <Menu>
                <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${u.full_name}`}><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent>
                  {can('users.edit') && <MenuItem onSelect={() => setEditing(u)}><Pencil />Edit</MenuItem>}
                  {can('users.edit') && u.locked && <MenuItem onSelect={() => act.mutate({ id: u.id, action: 'unlock' })}><Unlock />Unlock sign-in</MenuItem>}
                  {can('users.edit') && <MenuItem onSelect={() => run(u, 'sign-out', 'Sign out everywhere', `${u.full_name} will be signed out on all devices.`)}><LogOut />Sign out everywhere</MenuItem>}
                  {can('users.edit') && u.mfa_enabled && <MenuItem onSelect={() => run(u, 'reset-mfa', 'Reset two-factor authentication', `${u.full_name} can sign in with their password only and set up 2FA again.`)}><ShieldOff />Reset 2FA</MenuItem>}
                  {can('users.delete') && u.id !== me?.id && (<><MenuSeparator />
                    <MenuItem danger onSelect={() => run(u, 'delete', 'Delete user', `${u.full_name} will lose access. Their history is kept for auditing.`, true)}><Trash2 />Delete</MenuItem></>)}
                </MenuContent>
              </Menu>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {editing && <UserDialog user={editing === 'new' ? null : editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserDialog({ user, roles, onClose }: { user: AdminUser | null; roles: Role[]; onClose: () => void }) {
  const { user: me } = useAuth();
  const [form, setForm] = useState({
    full_name: user?.full_name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', password: '', status: user?.status ?? 'active',
    roles: user?.roles.map((r) => r.key) ?? ['verified_alumni'],
  });
  const [sendLink, setSendLink] = useState(true);
  const save = useAction(() => user
    ? api(`/api/v1/admin/users/${user.id}`, { method: 'PATCH', body: { full_name: form.full_name, phone: form.phone || null, roles: form.roles, status: form.status } })
    : api('/api/v1/admin/users', { method: 'POST', body: { full_name: form.full_name, email: form.email, phone: form.phone || null, roles: form.roles, password: sendLink ? null : form.password } }),
  { success: user ? 'User updated.' : sendLink ? 'User created. A link to set their password was emailed.' : 'User created.', invalidate: [['admin-users']], onSuccess: onClose });
  const e = save.fieldErrors;
  const toggle = (k: string) => setForm((f) => ({ ...f, roles: f.roles.includes(k) ? f.roles.filter((x) => x !== k) : [...f.roles, k] }));
  const staff = roles.filter((r) => r.is_staff);
  const members = roles.filter((r) => !r.is_staff);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={user ? `Edit ${user.full_name}` : 'Add user'} wide
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!form.roles.length}>{user ? 'Save changes' : 'Create user'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={e.full_name}>{(id) => <Input id={id} value={form.full_name} onChange={(x) => setForm({ ...form, full_name: x.target.value })} />}</Field>
        <Field label="Email" required error={e.email}>{(id) => <Input id={id} type="email" value={form.email} disabled={!!user} onChange={(x) => setForm({ ...form, email: x.target.value })} />}</Field>
        <Field label="Mobile number" error={e.phone}>{(id) => <Input id={id} value={form.phone} onChange={(x) => setForm({ ...form, phone: x.target.value })} placeholder="+92 300 1234567" />}</Field>
        {user ? (
          <Field label="Status">{(id) => (
            <Select id={id} value={form.status} disabled={user.id === me?.id} onChange={(x) => setForm({ ...form, status: x.target.value })}>
              <option value="active">Active</option><option value="pending">Pending verification</option><option value="deactivated">Deactivated</option>
            </Select>)}</Field>
        ) : (
          <div className="space-y-2">
            <Checkbox checked={sendLink} onCheckedChange={setSendLink} label="Email a link to set their password" />
            {!sendLink && <Field label="Password" required error={e.password}>{(id) => <PasswordInput id={id} autoComplete="new-password" value={form.password} onChange={(x) => setForm({ ...form, password: x.target.value })} />}</Field>}
          </div>
        )}
      </div>
      <fieldset className="mt-5">
        <legend className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink"><KeyRound className="h-4 w-4 text-primary" />Roles</legend>
        {e.roles && <p className="mb-2 text-xs text-danger">{e.roles}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {[['Staff roles', staff], ['Member roles', members]].map(([title, list]) => (
            <div key={title as string} className="rounded-card border border-line p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{title as string}</p>
              <div className="space-y-2">{(list as Role[]).map((r) => <Checkbox key={r.key} checked={form.roles.includes(r.key)} onCheckedChange={() => toggle(r.key)} label={r.name} />)}</div>
            </div>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}

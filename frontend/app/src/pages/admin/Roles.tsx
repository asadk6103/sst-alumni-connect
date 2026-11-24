import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Lock, Plus, Save, Trash2, Users } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Switch, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';

type Role = { id: string; key: string; name: string; description: string; is_system: boolean; is_staff: boolean; permissions: string[]; user_count: number };
type Catalogue = { admin: { module: string; label: string; actions: string[] }[]; portal: { key: string; label: string }[] };
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'publish', 'export', 'configure'];

export function RolesPage() {
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/api/v1/admin/roles') });
  const cat = useQuery({ queryKey: ['permission-catalogue'], queryFn: () => get<Catalogue>('/api/v1/admin/roles/catalogue') });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const role = roles.data?.find((r) => r.id === selected) ?? roles.data?.[0];

  return (
    <>
      <PageHeader title="Roles & Permissions" description="Permissions are enforced by the server for every request."
        actions={can('roles.create') && <Button onClick={() => setCreating(true)}><Plus />New role</Button>} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit overflow-hidden">
          {roles.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : (
            <ul className="divide-y divide-line" aria-label="Roles">
              {roles.data?.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} aria-current={role?.id === r.id}
                    className={cn('flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-canvas', role?.id === r.id && 'bg-primary-soft/70')}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{r.name}</span>
                      <span className="flex items-center gap-1 text-xs text-ink-muted"><Users className="h-3 w-3" />{r.user_count} user{r.user_count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">{r.is_staff && <Badge tone="primary">Staff</Badge>}{r.is_system && <Lock className="h-3.5 w-3.5 text-ink-muted" aria-label="Built-in" />}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {role && cat.data ? <RoleEditor key={role.id} role={role} cat={cat.data} onDeleted={() => setSelected(null)} /> : <Skeleton className="h-96 rounded-card" />}
      </div>
      {creating && <NewRoleDialog onClose={() => setCreating(false)} onCreated={(id) => { setSelected(id); setCreating(false); }} />}
    </>
  );
}

function RoleEditor({ role, cat, onDeleted }: { role: Role; cat: Catalogue; onDeleted: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));
  const [meta, setMeta] = useState({ name: role.name, description: role.description, is_staff: role.is_staff });
  useEffect(() => { setPerms(new Set(role.permissions)); setMeta({ name: role.name, description: role.description, is_staff: role.is_staff }); }, [role]);
  const locked = role.key === 'super_admin' || !can('roles.edit');
  const dirty = useMemo(() => {
    const a = [...perms].sort().join(), b = [...role.permissions].sort().join();
    return a !== b || meta.name !== role.name || meta.description !== role.description || meta.is_staff !== role.is_staff;
  }, [perms, meta, role]);
  const save = useAction(() => api(`/api/v1/admin/roles/${role.id}`, { method: 'PUT', body: { ...meta, permissions: [...perms] } }),
    { success: 'Role saved.', invalidate: [['roles'], ['roles-brief']] });
  const del = useAction(() => api(`/api/v1/admin/roles/${role.id}`, { method: 'DELETE' }), { success: 'Role deleted.', invalidate: [['roles']], onSuccess: onDeleted });
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleRow = (keys: string[]) => setPerms((p) => { const n = new Set(p); const all = keys.every((k) => n.has(k)); keys.forEach((k) => (all ? n.delete(k) : n.add(k))); return n; });

  return (
    <Card>
      <div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {role.is_system ? (
            <div><h2 className="font-heading text-lg font-semibold text-ink">{role.name}</h2><p className="text-sm text-ink-muted">{role.description}</p></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role name">{(id) => <Input id={id} value={meta.name} disabled={locked} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />}</Field>
              <Field label="Description">{(id) => <Input id={id} value={meta.description} disabled={locked} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />}</Field>
              <div className="sm:col-span-2"><Switch checked={meta.is_staff} disabled={locked} onCheckedChange={(v) => setMeta({ ...meta, is_staff: v })} label="Staff role" description="Members with this role can open the administration portal." /></div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!role.is_system && can('roles.delete') && <Button variant="danger-outline" onClick={async () => {
            if (await confirm({ title: 'Delete role', description: `Delete "${role.name}"? Users must be reassigned first.`, danger: true, confirmLabel: 'Delete' })) del.mutate(undefined);
          }}><Trash2 />Delete</Button>}
          {!locked && <Button onClick={() => save.mutate(undefined)} disabled={!dirty} loading={save.isPending}><Save />Save</Button>}
        </div>
      </div>
      {role.key === 'super_admin' && <div className="p-5 pb-0"><Alert tone="info">The Super Administrator role always has every permission.</Alert></div>}
      <div className="overflow-x-auto p-5">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="mb-3 text-left font-heading text-[15px] font-semibold text-ink">Administration permissions</caption>
          <thead>
            <tr className="text-xs text-ink-muted"><th className="py-2 text-left font-medium">Module</th>{ACTIONS.map((a) => <th key={a} className="px-1 py-2 font-medium capitalize">{a}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cat.admin.map((m) => {
              const keys = m.actions.map((a) => `${m.module}.${a}`);
              return (
                <tr key={m.module}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <button type="button" disabled={locked} className="text-left text-ink hover:text-primary disabled:hover:text-ink" onClick={() => toggleRow(keys)} title="Toggle all">{m.label}</button>
                  </th>
                  {ACTIONS.map((a) => (
                    <td key={a} className="px-1 py-2 text-center">
                      {m.actions.includes(a) ? (
                        <span className="inline-flex"><Checkbox checked={role.key === 'super_admin' || perms.has(`${m.module}.${a}`)} disabled={locked}
                          onCheckedChange={() => toggle(`${m.module}.${a}`)} id={`${role.id}-${m.module}-${a}`} /><span className="sr-only">{m.label} {a}</span></span>
                      ) : <span className="text-line">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3 className="mb-3 mt-8 font-heading text-[15px] font-semibold text-ink">Alumni portal permissions</h3>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {cat.portal.map((p) => <Checkbox key={p.key} checked={role.key === 'super_admin' || perms.has(p.key)} disabled={locked} onCheckedChange={() => toggle(p.key)} label={p.label} />)}
        </div>
      </div>
    </Card>
  );
}

function NewRoleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ name: '', description: '', is_staff: true });
  const create = useAction(() => api<{ data: Role }>('/api/v1/admin/roles', { method: 'POST', body: { ...form, permissions: [] } }),
    { success: 'Role created. Choose its permissions.', invalidate: [['roles']], onSuccess: (r) => onCreated(r.data.id) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="New role" description="Create the role, then pick its permissions."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={form.name.trim().length < 2}><KeyRound />Create</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={create.fieldErrors.name}>{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[70px]" />}</Field>
        <Switch checked={form.is_staff} onCheckedChange={(v) => setForm({ ...form, is_staff: v })} label="Staff role" description="Can open the administration portal." />
      </div>
    </Dialog>
  );
}

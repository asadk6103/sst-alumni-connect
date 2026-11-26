import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Building2, Check, Clock, MapPin, MessageSquareText, MoreHorizontal, Star, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { classLabel, photoUrl, place, type Photo, type PersonCard } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Card } from '@/components/ui/display';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay';
import { VerifiedBadge } from '@/components/alumni';

export type Face = { id: string; full_name: string; photo: Photo };
export type Person = PersonCard & { mutual?: number; mutual_people?: Face[]; online?: boolean; request_id?: string; since?: string };
const REFRESH = [['directory'], ['connections'], ['network-summary'], ['suggestions'], ['alumni-dashboard'], ['alumni-profile'], ['find-alumni']];

/** Connect / accept / message / follow actions shared by every people list. */
export function usePersonActions(p: Person) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const refresh = () => REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const connect = useAction(() => api('/api/v1/alumni/connections', { method: 'POST', body: { user_id: p.id } }), { success: 'Connection request sent.', onSuccess: refresh });
  const respond = useAction((action: 'accept' | 'decline') => api(`/api/v1/alumni/connections/${p.request_id ?? p.connection_id}/${action}`, { method: 'POST' }),
    { success: (r) => ((r as { data: { status: string } }).data.status === 'accepted' ? 'You are now connected.' : 'Request declined.'), onSuccess: refresh });
  const withdraw = useAction(() => api(`/api/v1/alumni/connections/${p.connection_id}`, { method: 'DELETE' }), { success: p.connection === 'accepted' ? 'Connection removed.' : 'Request withdrawn.', onSuccess: refresh });
  const follow = useAction(() => api(`/api/v1/alumni/profiles/${p.id}/follow`, { method: p.following ? 'DELETE' : 'POST' }), { onSuccess: refresh });
  const message = useAction(() => api<{ data: { id: string } }>('/api/v1/messages/conversations/direct', { method: 'POST', body: { user_id: p.id } }),
    { onSuccess: (r) => nav(`/portal/messages/${r.data.id}`) });
  return { connect, respond, withdraw, follow, message };
}

export function MutualFaces({ p, className }: { p: Person; className?: string }) {
  if (!p.mutual) return null;
  return (
    <span className={cn('flex items-center gap-2 text-[13px] text-ink-muted', className)}>
      {!!p.mutual_people?.length && <span className="flex -space-x-2">{p.mutual_people.map((f) => <Avatar key={f.id} name={f.full_name} src={photoUrl(f.photo, 48)} size={22} className="ring-2 ring-surface" />)}</span>}
      {p.mutual} mutual
    </span>
  );
}

export function PresenceAvatar({ p, size = 60 }: { p: Pick<Person, 'full_name' | 'photo' | 'online'>; size?: number }) {
  return (
    <span className="relative inline-block shrink-0">
      <Avatar name={p.full_name} src={photoUrl(p.photo, size * 2)} size={size} />
      {p.online !== undefined && <span className={cn('absolute bottom-0.5 end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-surface', p.online ? 'bg-success' : 'bg-line')} aria-label={p.online ? 'Online' : 'Offline'} />}
    </span>
  );
}

/** Primary action: Connect / Pending / Accept / Message. */
export function PrimaryAction({ p, size = 'sm' }: { p: Person; size?: 'sm' | 'md' }) {
  const { can } = useAuth();
  const a = usePersonActions(p);
  if (!can('portal.connect')) return null;
  if (p.connection === 'accepted') return <Button size={size} variant="outline" className="border-primary/50 text-primary" loading={a.message.isPending} onClick={() => a.message.mutate(undefined)}><MessageSquareText />Message</Button>;
  if (p.connection === 'sent') return <Button size={size} variant="outline" loading={a.withdraw.isPending} onClick={() => a.withdraw.mutate(undefined)} title="Withdraw request"><Clock />Pending</Button>;
  if (p.connection === 'received') return <Button size={size} loading={a.respond.isPending} onClick={() => a.respond.mutate('accept')}><Check />Accept</Button>;
  return <Button size={size} loading={a.connect.isPending} onClick={() => a.connect.mutate(undefined)}><UserPlus />Connect</Button>;
}

export function PersonMenu({ p }: { p: Person }) {
  const nav = useNavigate();
  const confirm = useConfirm();
  const a = usePersonActions(p);
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9" aria-label={`More actions for ${p.full_name}`}><MoreHorizontal /></Button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => nav(`/portal/alumni/${p.id}`)}><Users />View profile</MenuItem>
        {p.connection !== 'accepted' && <MenuItem onSelect={() => a.message.mutate(undefined)}><MessageSquareText />Message</MenuItem>}
        <MenuItem onSelect={() => a.follow.mutate(undefined)}>{p.following ? <><UserMinus />Unfollow</> : <><Star />Follow</>}</MenuItem>
        {p.connection === 'received' && <MenuItem onSelect={() => a.respond.mutate('decline')}><X />Decline request</MenuItem>}
        {p.connection === 'accepted' && <><MenuSeparator /><MenuItem danger onSelect={async () => { if (await confirm({ title: `Remove ${p.full_name} from your connections?`, danger: true, confirmLabel: 'Remove' })) a.withdraw.mutate(undefined); }}><UserMinus />Remove connection</MenuItem></>}
      </MenuContent>
    </Menu>
  );
}

/** Directory / Find Alumni list row. */
export function PersonRow({ p, actions, extra, variant = 'directory' }: { p: Person; actions?: ReactNode; extra?: ReactNode; variant?: 'directory' | 'table' }) {
  const job = [p.designation, p.organization].filter(Boolean).join(' at ');
  if (variant === 'table') return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[auto_minmax(150px,1.1fr)_minmax(140px,1fr)_minmax(110px,0.8fr)_auto_auto]">
      <Link to={`/portal/alumni/${p.id}`}><PresenceAvatar p={p} size={52} /></Link>
      <div className="min-w-0"><Link to={`/portal/alumni/${p.id}`} className="flex items-center gap-1.5 font-semibold text-ink hover:text-primary"><span className="truncate">{p.full_name}</span>{p.verified && <VerifiedBadge />}</Link>
        <p className="text-sm text-ink-muted">{classLabel(p)}</p></div>
      <div className="hidden min-w-0 text-[13px] text-ink md:block">{p.designation && <p className="flex items-center gap-1.5 truncate"><Briefcase className="h-3.5 w-3.5 shrink-0 text-ink-muted" />{p.designation}</p>}
        {p.organization && <p className="mt-0.5 flex items-center gap-1.5 truncate"><Building2 className="h-3.5 w-3.5 shrink-0 text-ink-muted" />{p.organization}</p>}</div>
      <p className="hidden items-center gap-1.5 truncate text-[13px] text-ink md:flex">{place(p) && <><MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" />{place(p)}</>}</p>
      <MutualFaces p={p} className="hidden md:flex" />
      <div className="flex items-center gap-2">{actions ?? <><PrimaryAction p={p} /><PersonMenu p={p} /></>}</div>
    </div>
  );
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <Link to={`/portal/alumni/${p.id}`}><PresenceAvatar p={p} size={72} /></Link>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2"><Link to={`/portal/alumni/${p.id}`} className="font-heading text-lg font-semibold text-ink hover:text-primary">{p.full_name}</Link>
          {p.verified && <VerifiedBadge />}{classLabel(p) && <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">{classLabel(p)}</span>}</p>
        {job && <p className="mt-1 flex items-center gap-1.5 text-sm text-ink"><Briefcase className="h-4 w-4 shrink-0 text-ink-muted" /><span className="truncate">{job}</span></p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-muted">{place(p) && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{place(p)}</span>}
          {!!p.mutual && <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />{p.mutual} mutual connection{p.mutual === 1 ? '' : 's'}</span>}{extra}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions ?? <><PrimaryAction p={p} /><MessageButton p={p} /><PersonMenu p={p} /></>}</div>
    </Card>
  );
}

function MessageButton({ p }: { p: Person }) {
  const { can } = useAuth();
  const a = usePersonActions(p);
  if (p.connection === 'accepted' || !can('portal.message')) return null;
  return <Button size="sm" variant="outline" loading={a.message.isPending} onClick={() => a.message.mutate(undefined)}><MessageSquareText />Message</Button>;
}

/** Grid card with a campus strip (Find Alumni grid view, suggestions). */
export function PersonGridCard({ p }: { p: Person }) {
  const site = useSite();
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  return (
    <Card className="overflow-hidden text-center">
      <div className="relative h-20 bg-navy">{banner && <img src={pickVariant(banner, 480)} alt="" className="h-full w-full object-cover opacity-90" />}
        <div className="absolute end-2 top-2"><PersonMenu p={p} /></div></div>
      <div className="-mt-11 flex justify-center"><span className="rounded-full ring-4 ring-surface"><PresenceAvatar p={p} size={84} /></span></div>
      <div className="px-4 pb-4 pt-2">
        <Link to={`/portal/alumni/${p.id}`} className="inline-flex items-center gap-1.5 font-heading font-semibold text-ink hover:text-primary">{p.full_name}{p.verified && <VerifiedBadge />}</Link>
        <p className="text-sm text-ink-muted">{classLabel(p)}</p>
        <div className="mt-2 space-y-1 text-[13px] text-ink">
          {p.designation && <p className="flex items-center justify-center gap-1.5"><Briefcase className="h-3.5 w-3.5 text-ink-muted" /><span className="truncate">{[p.designation, p.organization].filter(Boolean).join(' at ')}</span></p>}
          {place(p) && <p className="flex items-center justify-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-ink-muted" />{place(p)}</p>}
          {!!p.mutual && <p className="flex items-center justify-center gap-1.5 text-ink-muted"><Users className="h-3.5 w-3.5" />{p.mutual} mutual connections</p>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2"><PrimaryAction p={p} /><Link to={`/portal/alumni/${p.id}`}><Button size="sm" variant="outline" className="w-full">View Profile</Button></Link></div>
      </div>
    </Card>
  );
}

/** Small row used in side cards (people you may know, pending requests). */
export function MiniPerson({ p, action }: { p: Person; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <Link to={`/portal/alumni/${p.id}`}><Avatar name={p.full_name} src={photoUrl(p.photo, 96)} size={42} /></Link>
      <Link to={`/portal/alumni/${p.id}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink hover:text-primary">{p.full_name}</span>
        <span className="block truncate text-xs text-ink-muted">{classLabel(p)}</span>
        {!!p.mutual && <span className="block text-xs text-ink-muted">{p.mutual} mutual connections</span>}</Link>
      {action ?? <PrimaryAction p={p} />}
    </li>
  );
}

export function StatTile({ icon: Icon, value, label, tone = 'primary' }: { icon: typeof Users; value: ReactNode; label: string; tone?: 'primary' | 'success' | 'info' | 'warning' }) {
  const tones = { primary: 'bg-primary-soft text-primary', success: 'bg-success/10 text-success', info: 'bg-sky-100 text-sky-700', warning: 'bg-amber-100 text-amber-700' };
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full', tones[tone])}><Icon className="h-6 w-6" /></span>
      <span><span className="block font-heading text-2xl font-semibold text-ink">{value}</span><span className="block text-sm text-ink-muted">{label}</span></span>
    </Card>
  );
}


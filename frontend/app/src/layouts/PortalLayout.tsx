import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu as MenuIcon, X } from 'lucide-react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LiveProvider } from '@/lib/live';
import { useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand';
import { NotificationBell } from '@/components/notifications';
import { UserMenu } from './UserMenu';

type Item = { to: string; label: string; end?: boolean; perm?: string; module?: string };
// Sections appear as their modules are delivered (community, events, jobs … from Stage 3).
const PORTAL_NAV: Item[] = [
  { to: '/portal', label: 'Dashboard', end: true },
  { to: '/portal/directory', label: 'Directory', perm: 'portal.directory', module: 'directory' },
  { to: '/portal/community', label: 'Community', perm: 'portal.react', module: 'community' },
  { to: '/portal/events', label: 'Events', module: 'events' },
  { to: '/portal/jobs', label: 'Jobs', perm: 'portal.jobs.view', module: 'jobs' },
  { to: '/portal/mentorship', label: 'Mentorship', module: 'mentorship' },
  { to: '/portal/messages', label: 'Messages', perm: 'portal.message', module: 'messaging' },
];

/** Dark navy global top navigation from the design, white workspace below. */
export function PortalLayout() {
  const { user, can } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = PORTAL_NAV.filter((i) => (!i.perm || can(i.perm)) && (!i.module || site.modules[i.module] !== false));
  const link = (mobile: boolean) => ({ isActive }: { isActive: boolean }) => mobile
    ? cn('block rounded-btn px-3 py-2.5 text-sm hover:bg-white/10', isActive && 'bg-white/10 font-medium')
    : cn('flex items-center whitespace-nowrap border-b-[3px] px-3 text-sm font-medium transition-colors',
      isActive ? 'border-secondary text-white' : 'border-transparent text-white/75 hover:text-white');
  return (
    <LiveProvider enabled={!!user}>
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 bg-navy text-white shadow-[0_1px_0_rgb(255_255_255/0.06)]">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <button className="rounded-btn p-2 hover:bg-white/10 xl:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <Link to="/portal" className="flex min-w-0 items-center gap-4">
            <BrandMark light size={38} />
            <span className="hidden h-8 w-px bg-white/20 md:block" />
            <span className="hidden whitespace-nowrap font-heading text-[15px] font-semibold md:block">Alumni Portal</span>
          </Link>
          <nav aria-label="Portal" className="ml-4 hidden h-full items-stretch gap-1 xl:flex">
            {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={link(false)}>{i.label}{i.to === '/portal/messages' && <UnreadBadge />}</NavLink>)}
            {user?.is_staff && <NavLink to="/admin" className={link(false)}>Administration</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-2"><NotificationBell light /><UserMenu light /></div>
        </div>
        {open && (
          <nav aria-label="Portal" className="border-t border-white/10 px-4 py-2 xl:hidden">
            {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={link(true)}>{i.label}{i.to === '/portal/messages' && <UnreadBadge />}</NavLink>)}
            {user?.is_staff && <NavLink to="/admin" className={link(true)}>Administration</NavLink>}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:py-8"><Outlet /></main>
    </div>
    </LiveProvider>
  );
}

function UnreadBadge() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['unread'], queryFn: () => get<{ total: number }>('/api/v1/messages/unread'), enabled: can('portal.message'), refetchInterval: 120_000 });
  const n = q.data?.total ?? 0;
  if (!n) return null;
  return <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-[11px] font-semibold leading-[18px] text-white" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>;
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useLiveEvents } from '@/lib/live';
import { useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand';
import { UserMenu } from './UserMenu';

type Item = { to: string; label: string; end?: boolean; perm?: string; module?: string };
// Sections appear as their modules are delivered (community, events, jobs … from Stage 3).
const PORTAL_NAV: Item[] = [
  { to: '/portal', label: 'Dashboard', end: true },
  { to: '/portal/directory', label: 'Alumni Directory', perm: 'portal.directory', module: 'directory' },
  { to: '/portal/connections', label: 'My Network', perm: 'portal.directory', module: 'directory' },
  { to: '/portal/profile', label: 'My Profile' },
  { to: '/portal/account', label: 'Account' },
];

/** Dark navy global top navigation from the design, white workspace below. */
export function PortalLayout() {
  const { user, can } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useLiveEvents(!!user);
  const items = PORTAL_NAV.filter((i) => (!i.perm || can(i.perm)) && (!i.module || site.modules[i.module] !== false));
  const link = (mobile: boolean) => ({ isActive }: { isActive: boolean }) => mobile
    ? cn('block rounded-btn px-3 py-2.5 text-sm hover:bg-white/10', isActive && 'bg-white/10 font-medium')
    : cn('flex items-center whitespace-nowrap border-b-[3px] px-3 text-sm font-medium transition-colors',
      isActive ? 'border-secondary text-white' : 'border-transparent text-white/75 hover:text-white');
  return (
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
            {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={link(false)}>{i.label}</NavLink>)}
            {user?.is_staff && <NavLink to="/admin" className={link(false)}>Administration</NavLink>}
          </nav>
          <div className="ml-auto"><UserMenu light /></div>
        </div>
        {open && (
          <nav aria-label="Portal" className="border-t border-white/10 px-4 py-2 xl:hidden">
            {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={link(true)}>{i.label}</NavLink>)}
            {user?.is_staff && <NavLink to="/admin" className={link(true)}>Administration</NavLink>}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:py-8"><Outlet /></main>
    </div>
  );
}

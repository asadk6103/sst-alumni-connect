import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand';
import { UserMenu } from './UserMenu';

// Portal sections appear as modules are delivered (dashboard, directory, community … from Stage 2).
const PORTAL_NAV = [{ to: '/portal/account', label: 'My Account' }];

/** Dark navy global top navigation from the design, white workspace below. */
export function PortalLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 bg-navy text-white shadow-[0_1px_0_rgb(255_255_255/0.06)]">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <button className="rounded-btn p-2 hover:bg-white/10 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <Link to="/portal/account" className="flex items-center gap-4">
            <BrandMark light size={38} />
            <span className="hidden h-8 w-px bg-white/20 md:block" />
            <span className="hidden whitespace-nowrap font-heading text-[15px] font-semibold md:block">Alumni Portal</span>
          </Link>
          <nav aria-label="Portal" className="ml-4 hidden h-full items-stretch gap-1 lg:flex">
            {PORTAL_NAV.map((i) => (
              <NavLink key={i.to} to={i.to}
                className={({ isActive }) => cn('flex items-center border-b-[3px] px-3 text-sm font-medium transition-colors',
                  isActive ? 'border-secondary text-white' : 'border-transparent text-white/75 hover:text-white')}>
                {i.label}
              </NavLink>
            ))}
            {user?.is_staff && (
              <NavLink to="/admin" className="flex items-center border-b-[3px] border-transparent px-3 text-sm font-medium text-white/75 hover:text-white">Administration</NavLink>
            )}
          </nav>
          <div className="ml-auto"><UserMenu light /></div>
        </div>
        {open && (
          <nav aria-label="Portal" className="border-t border-white/10 px-4 py-2 lg:hidden">
            {PORTAL_NAV.map((i) => <NavLink key={i.to} to={i.to} className="block rounded-btn px-3 py-2.5 text-sm hover:bg-white/10">{i.label}</NavLink>)}
            {user?.is_staff && <NavLink to="/admin" className="block rounded-btn px-3 py-2.5 text-sm hover:bg-white/10">Administration</NavLink>}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:py-8"><Outlet /></main>
    </div>
  );
}

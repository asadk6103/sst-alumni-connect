import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { FolderOpen, LifeBuoy, UserX, Activity, BarChart3, ListPlus, Megaphone, BadgeCheck, Briefcase, HandHeart, Images, Newspaper, CalendarDays, Medal, UsersRound, FileClock, Gauge, GraduationCap, Image as ImageIcon, KeyRound, Layers, Mail, MessagesSquare, Menu as MenuIcon, Settings, ShieldCheck, Users,
  X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/brand';
import { NotificationBell } from '@/components/notifications';
import { UserMenu } from './UserMenu';

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; perms: string[]; end?: boolean };

// Sections appear as their modules are delivered; every entry here leads to a working screen.
export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, perms: ['dashboard.view'], end: true },
  { to: '/admin/alumni', label: 'Alumni Management', icon: GraduationCap, perms: ['alumni.view'] },
  { to: '/admin/verification', label: 'Alumni Verification', icon: BadgeCheck, perms: ['verification.view'] },
  { to: '/admin/batches', label: 'Batch Management', icon: Layers, perms: ['batches.view'] },
  { to: '/admin/community', label: 'Community Moderation', icon: MessagesSquare, perms: ['community.view'] },
  { to: '/admin/events', label: 'Events Management', icon: CalendarDays, perms: ['events.view'] },
  { to: '/admin/jobs', label: 'Jobs & Internships', icon: Briefcase, perms: ['jobs.view'] },
  { to: '/admin/mentorship', label: 'Mentorship', icon: UsersRound, perms: ['mentorship.view'] },
  { to: '/admin/achievements', label: 'Alumni Achievements', icon: Medal, perms: ['achievements.view'] },
  { to: '/admin/donations', label: 'Donations & Scholarships', icon: HandHeart, perms: ['donations.view', 'scholarships.view'] },
  { to: '/admin/gallery', label: 'Gallery', icon: Images, perms: ['gallery.view'] },
  { to: '/admin/newsletters', label: 'Newsletters', icon: Newspaper, perms: ['communications.view'] },
  { to: '/admin/news', label: 'News & Announcements', icon: Megaphone, perms: ['news.view'] },
  { to: '/admin/resources', label: 'Resource Hub', icon: FolderOpen, perms: ['resources.view'] },
  { to: '/admin/support', label: 'Help Desk', icon: LifeBuoy, perms: ['support.view'] },
  { to: '/admin/reports', label: 'Reports & Analytics', icon: BarChart3, perms: ['reports.view'] },
  { to: '/admin/custom-fields', label: 'Custom Fields', icon: ListPlus, perms: ['custom_fields.view'] },
  { to: '/admin/users', label: 'User Management', icon: Users, perms: ['users.view'] },
  { to: '/admin/privacy', label: 'Privacy Requests', icon: UserX, perms: ['users.view'] },
  { to: '/admin/roles', label: 'Roles & Permissions', icon: KeyRound, perms: ['roles.view'] },
  { to: '/admin/media', label: 'Media Library', icon: ImageIcon, perms: ['media.view'] },
  { to: '/admin/communications', label: 'Communication Center', icon: Mail, perms: ['communications.view'] },
  { to: '/admin/configuration', label: 'System Configuration', icon: Settings,
    perms: ['settings.view', 'branding.view', 'integrations.view', 'modules.view', 'feature_flags.view', 'donations.view'] },
  { to: '/admin/audit', label: 'Audit Logs', icon: FileClock, perms: ['audit.view'] },
  { to: '/admin/health', label: 'System Health', icon: Activity, perms: ['health.view'] },
];

export function AdminLayout() {
  const { can } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = ADMIN_NAV.filter((i) => i.perms.some(can));

  const nav = (
    <nav aria-label="Administration" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-btn px-3 py-2 text-[13.5px] font-medium transition-colors',
            isActive ? 'bg-primary text-white shadow-sm' : 'text-white/75 hover:bg-white/8 hover:text-white')}>
          <i.icon className="h-[18px] w-[18px] shrink-0" />{i.label}
        </NavLink>
      ))}
    </nav>
  );
  const head = (
    <Link to="/admin" className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
      <BrandMark light size={30} showName={false} />
      <span className="font-heading text-[15px] font-semibold text-white">Alumni Admin</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]">
      {/* The column paints the navy full-height; the panel inside stays in view while scrolling. */}
      <div className="hidden bg-navy lg:block">
        <aside className="sticky top-0 flex h-screen flex-col">
          {head}{nav}
          <p className="border-t border-white/10 px-5 py-3 text-[11px] text-white/45">{site.app_name}</p>
        </aside>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy-dark/50" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[264px] flex-col bg-navy">
            <button className="absolute right-3 top-4 rounded p-1 text-white/70 hover:text-white" onClick={() => setOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button>
            {head}{nav}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-btn p-2 text-ink hover:bg-canvas lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><MenuIcon className="h-5 w-5" /></button>
            <span className="hidden items-center gap-1.5 text-sm text-ink-muted sm:flex"><ShieldCheck className="h-4 w-4 text-primary" />Administration</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/portal" className="hidden text-sm font-medium text-ink-muted hover:text-ink sm:block">Alumni Portal</Link>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:py-8"><Outlet /></main>
      </div>
    </div>
  );
}

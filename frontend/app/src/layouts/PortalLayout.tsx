import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookMarked, Bookmark, Briefcase, CalendarDays, GraduationCap, Home, Mail, Menu as MenuIcon, MessageSquareText, Search, Settings,
  UserRound, Users, UsersRound, X, BookOpen,
} from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { LiveProvider } from '@/lib/live';
import { useT } from '@/lib/i18n';
import { photoUrl } from '@/lib/alumni';
import { useSite } from '@/lib/site';
import { cn, fmtDate } from '@/lib/utils';
import { BrandMark } from '@/components/brand';
import { NotificationBell } from '@/components/notifications';
import { Button } from '@/components/ui/button';
import { Avatar, Card } from '@/components/ui/display';
import { Field, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { UserMenu } from './UserMenu';

type Icon = ComponentType<{ className?: string }>;
type Item = { to: string; label: string; key: string; icon: Icon; end?: boolean; perm?: string; module?: string; match?: RegExp };

const TOP: Item[] = [
  { to: '/portal', label: 'Home', key: 'nav.home', icon: Home, end: true },
  { to: '/portal/network', label: 'Network', key: 'nav.network', icon: Users, perm: 'portal.directory', module: 'directory', match: /^\/portal\/(network|connections|directory|alumni)/ },
  { to: '/portal/community/groups', label: 'Community', key: 'nav.community', icon: UsersRound, perm: 'portal.react', module: 'community', match: /^\/portal\/community/ },
  { to: '/portal/jobs', label: 'Jobs', key: 'nav.jobs', icon: Briefcase, perm: 'portal.jobs.view', module: 'jobs' },
  { to: '/portal/events', label: 'Events', key: 'nav.events', icon: CalendarDays, module: 'events' },
];

const SIDE: Item[] = [
  { to: '/portal', label: 'Feed', key: 'nav.feed', icon: Home, end: true },
  { to: '/portal/network', label: 'My Network', key: 'nav.my_network', icon: Users, perm: 'portal.directory', module: 'directory', match: /^\/portal\/(network|connections)/ },
  { to: '/portal/messages', label: 'Messages', key: 'nav.messages', icon: MessageSquareText, perm: 'portal.message', module: 'messaging' },
  { to: '/portal/community/groups', label: 'Communities', key: 'nav.communities', icon: UsersRound, perm: 'portal.react', module: 'community', match: /^\/portal\/community\/groups/ },
  { to: '/portal/events', label: 'Events', key: 'nav.events', icon: CalendarDays, module: 'events' },
  { to: '/portal/directory', label: 'Alumni Directory', key: 'nav.directory', icon: BookOpen, perm: 'portal.directory', module: 'directory' },
  { to: '/portal/jobs', label: 'Jobs & Opportunities', key: 'nav.jobs_full', icon: Briefcase, perm: 'portal.jobs.view', module: 'jobs' },
  { to: '/portal/mentorship', label: 'Mentorship', key: 'nav.mentorship', icon: GraduationCap, module: 'mentorship' },
];
const SIDE2: Item[] = [
  { to: '/portal/saved', label: 'Saved Posts', key: 'nav.saved', icon: Bookmark, perm: 'portal.react', module: 'community' },
  { to: '/portal/profile', label: 'My Profile', key: 'menu.my_profile', icon: UserRound },
  { to: '/portal/account', label: 'Settings', key: 'nav.settings', icon: Settings },
];

/** Sidebar promo card per area (from the designs). */
function Promo({ onInvite }: { onInvite: () => void }) {
  const t = useT();
  const path = useLocation().pathname;
  const nav = useNavigate();
  const card = path.startsWith('/portal/community') ? { title: t('promo.communities', 'Join Communities'), text: 'Be part of batch, interest and professional groups. Share, discuss and collaborate with alumni.', label: 'Browse Communities', icon: UsersRound, go: '/portal/community/groups' }
    : path.startsWith('/portal/events') ? { title: t('promo.events', 'Host an Alumni Event'), text: 'Plan reunions, networking sessions, webinars and more for the SST alumni community.', label: 'Browse Events', icon: CalendarDays, go: '/portal/events' }
      : path.startsWith('/portal/jobs') ? { title: t('promo.jobs', 'Hire from the SST Alumni Network'), text: 'Post job openings, find talented alumni and grow your team.', label: '+ Post a Job', icon: Briefcase, go: '/portal/jobs/post' }
        : path.startsWith('/portal/mentorship') ? { title: t('promo.mentor', 'Become a Mentor'), text: 'Share your experience, guide fellow alumni and give back to the SST community.', label: '+ Join as a Mentor', icon: GraduationCap, go: '/portal/mentorship/tab/become' }
          : path.startsWith('/portal/directory') ? { title: t('promo.directory', 'Explore the Alumni Network'), text: 'Find, connect and collaborate with SST alumni across the globe.', label: 'Find Alumni', icon: Search, go: '/portal/directory' }
            : path.startsWith('/portal/profile') ? { title: t('promo.profile', 'Complete Your Alumni Profile'), text: 'A complete profile helps you get better connections and opportunities.', label: 'Update Profile', icon: UserRound, go: '/portal/profile/personal' }
              : null;
  const Icon = card?.icon ?? Users;
  return (
    <div className="mt-4 rounded-card bg-gradient-to-br from-primary-soft to-primary-soft/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-[17px] font-semibold leading-snug text-ink">{card?.title ?? t('promo.grow', 'Grow the SST Alumni Community')}</p>
        <Icon className="h-10 w-10 shrink-0 text-primary/80" />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{card?.text ?? 'Invite your classmates and help expand our alumni network.'}</p>
      {card
        ? <Button variant="outline" className="mt-3 w-full border-primary/50 bg-surface text-primary" onClick={() => nav(card.go)}>{card.label}</Button>
        : <Button variant="outline" className="mt-3 w-full border-primary/50 bg-surface text-primary" onClick={onInvite}><Mail />{t('invite.button', 'Invite Alumni')}</Button>}
    </div>
  );
}

function useUnread() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['unread'], queryFn: () => get<{ total: number }>('/api/v1/messages/unread'), enabled: can('portal.message'), refetchInterval: 120_000 });
  return q.data?.total ?? 0;
}

function Sidebar({ onInvite, onNavigate }: { onInvite: () => void; onNavigate?: () => void }) {
  const { can } = useAuth();
  const site = useSite();
  const t = useT();
  const unread = useUnread();
  const path = useLocation().pathname;
  const visible = (i: Item) => (!i.perm || can(i.perm)) && (!i.module || site.modules[i.module] !== false);
  const link = (i: Item) => (
    <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate}
      className={({ isActive }) => cn('flex items-center gap-3 rounded-btn px-3 py-2.5 text-[15px] font-medium transition-colors',
        (i.match ? i.match.test(path) : isActive) ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-canvas')}>
      <i.icon className="h-5 w-5 shrink-0" /><span className="flex-1 truncate">{t(i.key, i.label)}</span>
      {i.to === '/portal/messages' && unread > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  );
  return (
    <nav aria-label="Portal" className="flex flex-col">
      <div className="space-y-0.5">{SIDE.filter(visible).map(link)}</div>
      <div className="my-3 border-t border-line" />
      <div className="space-y-0.5">{SIDE2.filter(visible).map(link)}</div>
      <Promo onInvite={onInvite} />
    </nav>
  );
}

type Results = {
  alumni: { id: string; full_name: string; photo: import('@/lib/alumni').Photo; batch: string | null; designation: string | null }[];
  posts: { id: string; title: string | null; excerpt: string; author: { full_name: string } | null }[];
  communities: { id: string; name: string; member_count: number }[];
  events: { id: string; title: string; starts_at: string }[];
};

function GlobalSearch({ className }: { className?: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({ queryKey: ['global-search', dq], enabled: dq.length >= 2, queryFn: () => get<Results>(`/api/v1/search?q=${encodeURIComponent(dq)}&limit=4`) });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  const r = res.data;
  const empty = r && !r.alumni.length && !r.posts.length && !r.communities.length && !r.events.length;
  const group = (title: string, items: ReactNode[]) => items.length > 0 && <div className="py-1.5"><p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>{items}</div>;
  const row = (key: string, to: string, main: ReactNode, sub?: ReactNode, lead?: ReactNode) => (
    <button key={key} type="button" onClick={() => go(to)} className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-canvas">
      {lead}<span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{main}</span>{sub && <span className="block truncate text-xs text-ink-muted">{sub}</span>}</span></button>
  );
  return (
    <div ref={box} className={cn('relative', className)} role="search">
      <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
      <input aria-label="Search the portal" placeholder="Search alumni, posts, groups, events…" value={q} onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && dq.length >= 2) go(`/portal/directory?q=${encodeURIComponent(dq)}`); }}
        className="h-10 w-full rounded-btn border border-white/10 bg-white/10 ps-10 pe-3 text-sm text-white placeholder:text-white/60 focus:border-white/30 focus:bg-white/15 focus:outline-none" />
      {open && dq.length >= 2 && (
        <div className="absolute start-0 top-full z-50 mt-2 max-h-[70vh] w-full min-w-[320px] overflow-y-auto rounded-card border border-line bg-surface text-ink shadow-pop">
          {res.isLoading ? <p className="p-4 text-sm text-ink-muted">Searching…</p> : empty ? <p className="p-4 text-sm text-ink-muted">No results for “{dq}”.</p> : r && (
            <div className="divide-y divide-line">
              {group('Alumni', r.alumni.map((a) => row(a.id, `/portal/alumni/${a.id}`, a.full_name, [a.designation, a.batch].filter(Boolean).join(' • '), <Avatar name={a.full_name} src={photoUrl(a.photo, 64)} size={32} />)))}
              {group('Posts', r.posts.map((p) => row(p.id, `/portal/community/posts/${p.id}`, p.title || p.excerpt, p.author?.full_name)))}
              {group('Communities', r.communities.map((g) => row(g.id, `/portal/community/groups/${g.id}`, g.name, `${g.member_count} members`)))}
              {group('Events', r.events.map((e) => row(e.id, `/portal/events/${e.id}`, e.title, fmtDate(e.starts_at))))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Invite classmates by email (typed, pasted or imported from a CSV / vCard file). */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const list = Array.from(new Set((emails.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()))).slice(0, 50);
  const send = async () => {
    setBusy(true);
    try {
      await api('/api/v1/invitations', { method: 'POST', body: { emails: list, message } });
      toast.success(`Invitations sent to ${list.length} ${list.length === 1 ? 'person' : 'people'}.`);
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send invitations.'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Invite Alumni" description="Invite classmates and other SST alumni to join the network. Members already registered are skipped."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!list.length} onClick={send}><Mail />Send {list.length || ''} invitation{list.length === 1 ? '' : 's'}</Button></>}>
      <div className="space-y-4">
        <Field label="Email addresses" hint="Separate with commas or new lines (up to 50).">{(id, d) => <Textarea id={id} aria-describedby={d} value={emails} onChange={(e) => setEmails(e.target.value)} className="min-h-[100px]" placeholder="ali@example.com, sara@example.com" />}</Field>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}><BookMarked />Import from contacts</Button>
          <span className="text-xs text-ink-muted">CSV or vCard (.vcf) file exported from your email or phone</span>
          <input ref={file} type="file" accept=".csv,.vcf,text/csv,text/vcard" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && f.size < 2_000_000) { const text = await f.text(); setEmails((x) => `${x}\n${text}`); } }} />
        </div>
        {list.length > 0 && <p className="text-sm text-ink-muted">{list.length} address{list.length === 1 ? '' : 'es'} found.</p>}
        <Field label="Personal message (optional)">{(id) => <Textarea id={id} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} className="min-h-[70px]" placeholder="Hi! Join me on the SST Alumni Portal." />}</Field>
      </div>
    </Dialog>
  );
}

/** Page grid used by portal screens: main column + optional right column (sidebar is in the layout). */
export function PortalPage({ children, aside, wide }: { children: ReactNode; aside?: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('grid gap-6', aside && !wide && 'xl:grid-cols-[minmax(0,1fr)_330px]')}>
      <div className="min-w-0 space-y-5">{children}</div>
      {aside && <aside className="min-w-0 space-y-5">{aside}</aside>}
    </div>
  );
}

/** Navy top bar, left sidebar, workspace (the redesigned portal shell). */
export function PortalLayout() {
  const { user, can } = useAuth();
  const site = useSite();
  const t = useT();
  const nav = useNavigate();
  const unread = useUnread();
  const [drawer, setDrawer] = useState(false);
  const [invite, setInvite] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  const tabs = TOP.filter((i) => (!i.perm || can(i.perm)) && (!i.module || site.modules[i.module] !== false));
  const tabActive = (i: Item) => (i.match ? i.match.test(loc.pathname) : i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to));
  return (
    <LiveProvider enabled={!!user}>
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-30 bg-navy text-white shadow-[0_1px_0_rgb(255_255_255/0.06)]">
          <div className="mx-auto flex h-16 max-w-[1560px] items-center gap-3 px-3 sm:px-5">
            <button className="rounded-btn p-2 hover:bg-white/10 lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu"><MenuIcon className="h-5 w-5" /></button>
            <Link to="/portal" className="flex min-w-0 items-center gap-4">
              <BrandMark light size={40} className="hidden sm:flex" />
              <BrandMark light size={36} showName={false} className="sm:hidden" />
              <span className="hidden h-8 w-px bg-white/20 xl:block" />
              <span className="hidden whitespace-nowrap font-heading text-[17px] font-semibold xl:block">{t('site.portal', 'Alumni Portal')}</span>
            </Link>
            <GlobalSearch className="mx-2 hidden max-w-[420px] flex-1 md:block" />
            <nav aria-label="Main" className="ms-auto hidden h-16 items-stretch lg:flex">
              {tabs.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={cn('flex w-[84px] flex-col items-center justify-center gap-1 text-[13px] font-medium transition-colors',
                    tabActive(i) ? 'rounded-b-btn bg-primary text-white' : 'text-white/80 hover:text-white')}>
                  <i.icon className="h-5 w-5" />{t(i.key, i.label)}
                </NavLink>
              ))}
            </nav>
            <div className="ms-auto flex items-center gap-1 lg:ms-3">
              <button className="rounded-btn p-2 hover:bg-white/10 md:hidden" aria-label="Search" onClick={() => nav('/portal/directory')}><Search className="h-5 w-5" /></button>
              <NotificationBell light />
              {can('portal.message') && (
                <Link to="/portal/messages" className="relative rounded-btn p-2 hover:bg-white/10" aria-label={`Messages${unread ? `, ${unread} unread` : ''}`}>
                  <MessageSquareText className="h-5 w-5" />
                  {unread > 0 && <span className="absolute end-0.5 top-0.5 min-w-[18px] rounded-full bg-primary px-1 text-center text-[11px] font-semibold leading-[18px]">{unread > 9 ? '9+' : unread}</span>}
                </Link>
              )}
              <UserMenu light />
            </div>
          </div>
        </header>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-navy-dark/50" onClick={() => setDrawer(false)} />
            <div className="relative h-full w-[290px] overflow-y-auto bg-surface p-4">
              <div className="mb-3 flex items-center justify-between"><BrandMark size={34} /><button onClick={() => setDrawer(false)} aria-label="Close" className="rounded p-1 text-ink-muted"><X className="h-5 w-5" /></button></div>
              <GlobalSearch className="mb-3 [&_input]:border-line [&_input]:bg-navy [&_input]:text-white" />
              <Sidebar onInvite={() => setInvite(true)} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}
        <div className="mx-auto flex max-w-[1560px] gap-6 px-3 py-5 sm:px-5 lg:py-6">
          <aside className="hidden w-[250px] shrink-0 lg:block">
            <Card className="sticky top-[88px] max-h-[calc(100vh-104px)] overflow-y-auto p-3"><Sidebar onInvite={() => setInvite(true)} /></Card>
          </aside>
          <main className="min-w-0 flex-1"><Outlet /></main>
        </div>
        {invite && <InviteDialog onClose={() => setInvite(false)} />}
      </div>
    </LiveProvider>
  );
}


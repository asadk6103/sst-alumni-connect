import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bookmark, CalendarDays, FileText, MapPin, UserPlus, Users, UsersRound } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { photoUrl, type Photo, type PersonCard } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Card, EmptyState } from '@/components/ui/display';
import { Composer, Feed, PostCard, SectionCard, useGroups, type GroupT, type PostT } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

type Me = { full_name: string; kind: string; batch: string | null; graduation_year: number | null; photo: Photo; connections: number; groups: number; events: number };
type Ev = { id: string; title: string; starts_at: string; venue: string | null; is_online: boolean; my_registration: { status: string } | null };
type Dash = { me: Me; suggestions?: PersonCard[]; events?: Ev[] };

const TABS = [{ k: 'all', l: 'All Posts' }, { k: 'following', l: 'Following' }, { k: 'batch', l: 'My Batch' }, { k: 'groups', l: 'Groups' }];

function greeting(t: (k: string, f: string) => string) {
  const h = new Date().getHours();
  return h < 12 ? t('feed.morning', 'Good morning') : h < 17 ? t('feed.afternoon', 'Good afternoon') : t('feed.evening', 'Good evening');
}

export function FeedPage() {
  const { user, can } = useAuth();
  const site = useSite();
  const t = useT();
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState<'latest' | 'relevant'>('latest');
  const dash = useQuery({ queryKey: ['alumni-dashboard'], queryFn: () => get<Dash>('/api/v1/alumni/dashboard') });
  const mine = useGroups('mine');
  const first = (user?.full_name ?? '').split(' ')[0];
  return (
    <PortalPage aside={<FeedAside dash={dash.data} groups={mine.data ?? []} />}>
      <div>
        <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink">{greeting(t)}, {first} <span aria-hidden>👋</span></h1>
        <p className="mt-1 text-ink-muted">{t('feed.subtitle', 'Stay connected with the {school} alumni community.').replace('{school}', site.institution_name)}</p>
      </div>
      {can('portal.post') && <Composer groups={mine.data} announcementAllowed={can('community.publish')} />}
      <div className="flex items-center justify-between gap-3 border-b border-line">
        <div className="flex overflow-x-auto" role="tablist">
          {TABS.map((x) => <button key={x.k} role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)}
            className={cn('shrink-0 border-b-[3px] px-4 py-3 text-[15px] font-medium', tab === x.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>{t(`feed.tab.${x.k}`, x.l)}</button>)}
        </div>
        <label className="flex shrink-0 items-center gap-1 text-sm text-ink-muted">Sort by:
          <select value={sort} onChange={(e) => setSort(e.target.value as 'latest')} className="cursor-pointer bg-transparent font-semibold text-ink focus:outline-none">
            <option value="latest">Latest</option><option value="relevant">Most relevant</option></select></label>
      </div>
      <Feed key={`${tab}-${sort}`} filter={tab} sort={sort} />
    </PortalPage>
  );
}

function FeedAside({ dash, groups }: { dash?: Dash; groups: GroupT[] }) {
  const site = useSite();
  const nav = useNavigate();
  const qc = useQueryClient();
  const discover = useGroups('discover');
  const join = useAction((id: string) => api(`/api/v1/community/groups/${id}/join`, { method: 'POST' }), { success: 'Request sent.', invalidate: [['groups']] });
  const connect = useAction((id: string) => api('/api/v1/alumni/connections', { method: 'POST', body: { user_id: id } }),
    { success: 'Connection request sent.', onSuccess: () => qc.invalidateQueries({ queryKey: ['alumni-dashboard'] }) });
  const me = dash?.me;
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  const groupRows = [...groups.slice(0, 3).map((g) => ({ g, member: true })), ...(discover.data ?? []).filter((g) => !g.membership).slice(0, Math.max(0, 3 - groups.length)).map((g) => ({ g, member: false }))];
  const events = (dash?.events ?? []).slice(0, 3);
  return (
    <>
      <Card className="overflow-hidden">
        <div className="h-24 bg-navy">{banner && <img src={pickVariant(banner, 640)} alt="" className="h-full w-full object-cover" />}</div>
        <div className="px-4 pb-4">
          <div className="-mt-9 flex items-end justify-between gap-2">
            <Avatar name={me?.full_name} src={photoUrl(me?.photo ?? null, 160)} size={76} className="ring-4 ring-surface" />
            <Link to="/portal/profile" className="mb-1 flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View Profile<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>
          </div>
          <p className="mt-2 font-heading text-lg font-semibold text-ink">{me?.full_name}</p>
          <p className="text-sm text-ink-muted">{me ? [me.kind === 'student' ? 'Student' : 'Alumni', me.batch ?? (me.graduation_year ? `Class of ${me.graduation_year}` : null)].filter(Boolean).join(' • ') : ' '}</p>
          <div className="mt-4 grid grid-cols-3 divide-x divide-line border-t border-line pt-3 text-center rtl:divide-x-reverse">
            {[['Connections', me?.connections, '/portal/connections'], ['Groups', me?.groups, '/portal/community/groups'], ['Events', me?.events, '/portal/events']].map(([l, n, to]) => (
              <Link key={l as string} to={to as string} className="hover:text-primary"><p className="font-heading text-lg font-semibold text-ink">{(n as number | undefined) ?? '–'}</p><p className="text-xs text-ink-muted">{l}</p></Link>))}
          </div>
        </div>
      </Card>
      <SectionCard title="Upcoming Events" icon={CalendarDays} action={<Link to="/portal/events" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View All<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>}>
        {events.length === 0 ? <p className="text-sm text-ink-muted">No upcoming events.</p> : (
          <ul className="divide-y divide-line">
            {events.map((e) => { const d = new Date(e.starts_at); return (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className="w-12 shrink-0 rounded-btn bg-primary-soft py-1 text-center"><span className="block text-[11px] font-semibold uppercase text-primary">{d.toLocaleString('en', { month: 'short' })}</span><span className="block font-heading text-lg font-semibold leading-none text-ink">{d.getDate()}</span></span>
                <Link to={`/portal/events/${e.id}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink hover:text-primary">{e.title}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-ink-muted"><MapPin className="h-3 w-3 shrink-0" />{e.is_online ? 'Online' : e.venue}</span></Link>
                <Button size="sm" className="h-8 px-3" variant={e.my_registration ? 'outline' : 'primary'} onClick={() => nav(`/portal/events/${e.id}`)}>{e.my_registration ? 'Going' : 'RSVP'}</Button>
              </li>); })}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="My Groups" icon={UsersRound} action={<Link to="/portal/community/groups" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View All<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>}>
        {groupRows.length === 0 ? <p className="text-sm text-ink-muted">Join a group to see it here.</p> : (
          <ul className="space-y-2.5">
            {groupRows.map(({ g, member }) => (
              <li key={g.id} className="flex items-center gap-3">
                {g.cover ? <img src={photoUrl(g.cover, 160) ?? ''} alt="" className="h-11 w-11 shrink-0 rounded-btn object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><Users className="h-5 w-5" /></span>}
                <Link to={`/portal/community/groups/${g.id}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink hover:text-primary">{g.name}</span><span className="block text-xs text-ink-muted">{g.member_count.toLocaleString()} members</span></Link>
                {member ? <Button size="sm" variant="outline" className="h-8 border-primary/50 px-3 text-primary" onClick={() => nav(`/portal/community/groups/${g.id}`)}>View</Button>
                  : <Button size="sm" variant="outline" className="h-8 border-primary/50 px-3 text-primary" loading={join.isPending && join.variables === g.id} onClick={() => join.mutate(g.id)}>Join</Button>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {(dash?.suggestions?.length ?? 0) > 0 && (
        <SectionCard title="People you may know" icon={UserPlus} action={<Link to="/portal/directory" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">View All<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>}>
          <ul className="space-y-3">
            {dash!.suggestions!.slice(0, 4).map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <Link to={`/portal/alumni/${p.id}`}><Avatar name={p.full_name} src={photoUrl(p.photo, 96)} size={44} /></Link>
                <Link to={`/portal/alumni/${p.id}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink hover:text-primary">{p.full_name}</span>
                  <span className="block truncate text-xs text-ink-muted">{[p.batch ?? (p.graduation_year ? `Class of ${p.graduation_year}` : null), p.city].filter(Boolean).join(' • ')}</span></Link>
                <Button size="sm" variant="outline" className="h-8 border-primary/50 px-3 text-primary" loading={connect.isPending && connect.variables === p.id} onClick={() => connect.mutate(p.id)}><UserPlus />Connect</Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

export function SavedPostsPage() {
  const [tab, setTab] = useState<'saved' | 'drafts'>('saved');
  return (
    <PortalPage>
      <div>
        <h1 className="font-heading text-[28px] font-semibold text-ink">Saved Posts</h1>
        <p className="mt-1 text-ink-muted">Posts you saved for later, and your unpublished drafts.</p>
      </div>
      <div className="flex border-b border-line" role="tablist">
        {[{ k: 'saved', l: 'Saved', i: Bookmark }, { k: 'drafts', l: 'Drafts', i: FileText }].map((x) => <button key={x.k} role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k as 'saved')}
          className={cn('flex items-center gap-2 border-b-[3px] px-4 py-3 text-[15px] font-medium', tab === x.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}><x.i className="h-4 w-4" />{x.l}</button>)}
      </div>
      {tab === 'saved' ? <Feed endpoint="/api/v1/community/saved" /> : <Drafts />}
    </PortalPage>
  );
}

function Drafts() {
  const q = useQuery({ queryKey: ['drafts'], queryFn: () => get<PostT[]>('/api/v1/community/drafts') });
  if (q.data && !q.data.length) return <Card><EmptyState icon={FileText} title="No drafts" description="Use “Save as Draft” in the post composer to finish a post later." /></Card>;
  return <div className="space-y-4">{q.data?.map((p) => <PostCard key={p.id} post={p} />)}</div>;
}

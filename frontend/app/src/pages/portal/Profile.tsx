import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, Award, Briefcase, Camera, CheckCircle2, Circle, Flag, GraduationCap, Grid2x2, Image as ImageIcon, Link2,
  Mail, MapPin, MessageSquareText, MoreHorizontal, Pencil, Phone, Settings, Star, UserMinus, UserRound, UserX, Users, UsersRound,
} from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { ACHIEVEMENT_KINDS, classLabel, monthYear, photoUrl, place, type MyProfile, type Photo, type ProfileDetail } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn, fmtDate, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import { NoAccess, VerifiedBadge } from '@/components/alumni';
import { ExtraFields } from '@/components/customFields';
import { Feed, SectionCard } from '@/components/community';
import { PrimaryAction, usePersonActions, type Person } from '@/components/people';
import { PortalPage } from '@/layouts/PortalLayout';

type Detail = ProfileDetail & { cover?: Photo; following_count?: number; mutual?: number; online?: boolean };
type Mine = MyProfile & { cover?: Photo; following_count?: number; completion_items: { key: string; label: string; tab: string; done: boolean }[] };
type Overview = { communities: { id: string; name: string; member_count: number; cover: Photo }[]; photos: NonNullable<Photo>[]; photo_count: number;
  connections: { id: string; full_name: string; photo: Photo }[]; connection_count: number; post_count: number };

/** Your own profile (`/portal/profile`). */
export function MyProfileViewPage() {
  const q = useQuery({ queryKey: ['my-profile'], queryFn: () => get<Mine>('/api/v1/alumni/me') });
  if (!q.data) return <Skeleton className="h-[520px] rounded-card" />;
  return <ProfileScreen p={q.data} self mine={q.data} />;
}

/** Another member's profile (`/portal/alumni/:id`). */
export function ProfileViewPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['alumni-profile', id], queryFn: () => get<Detail>(`/api/v1/alumni/profiles/${id}`),
    enabled: can('portal.directory') && id !== user?.id, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  if (id === user?.id) return <Navigate to="/portal/profile" replace />;
  if (!can('portal.directory')) return <NoAccess />;
  if (q.isLoading) return <Skeleton className="h-[520px] rounded-card" />;
  if (!q.data) return (
    <Card><EmptyState icon={UserX} title="Profile not available" description="This profile does not exist or its owner has made it private."
      action={<Button variant="outline" onClick={() => nav('/portal/directory')}><ArrowLeft />Back to the directory</Button>} /></Card>
  );
  return <ProfileScreen p={q.data} />;
}

const TABS = [
  { k: 'overview', l: 'Overview', i: Grid2x2 }, { k: 'posts', l: 'Posts', i: MessageSquareText }, { k: 'about', l: 'About', i: UserRound },
  { k: 'experience', l: 'Experience', i: Briefcase }, { k: 'education', l: 'Education', i: GraduationCap }, { k: 'mentorship', l: 'Mentorship', i: UsersRound },
  { k: 'activity', l: 'Activity', i: Activity },
];

function ProfileScreen({ p, self, mine }: { p: Detail; self?: boolean; mine?: Mine }) {
  const [tab, setTab] = useState('overview');
  const ov = useQuery({ queryKey: ['profile-overview', p.id], queryFn: () => get<Overview>(`/api/v1/alumni/profiles/${p.id}/overview`) });
  return (
    <PortalPage aside={<ProfileAside p={p} self={self} mine={mine} ov={ov.data} />}>
      <Card className="overflow-hidden">
        <Cover p={p} self={self} />
        <div className="relative px-5 pb-0 sm:px-7">
          <div className="flex flex-col gap-4 sm:flex-row">
            <PhotoBadge p={p} self={self} />
            <div className="min-w-0 flex-1 pt-2 sm:pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="flex flex-wrap items-center gap-2 font-heading text-[26px] font-semibold leading-tight text-ink">{p.full_name}{p.verified && <VerifiedBadge />}</h1>
                  <p className="text-[15px] text-ink-muted">{classLabel(p)}</p>
                </div>
                <HeaderActions p={p} self={self} />
              </div>
              <div className="mt-2 space-y-1.5 text-sm text-ink">
                {(p.designation || p.organization) && <p className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-ink-muted" />{[p.designation, p.organization].filter(Boolean).join(' at ')}</p>}
                <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  {place(p) && <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-muted" />{place(p)}</span>}
                  {p.email && <a href={`mailto:${p.email}`} className="flex items-center gap-2 hover:text-primary"><Mail className="h-4 w-4 text-ink-muted" />{p.email}</a>}
                  {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-2 hover:text-primary" dir="ltr"><Phone className="h-4 w-4 text-ink-muted" />{p.phone}</a>}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex overflow-x-auto border-t border-line" role="tablist">
            {TABS.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              className={cn('flex shrink-0 items-center gap-2 border-b-[3px] px-4 py-3.5 text-[15px] font-medium', tab === t.k ? 'border-primary text-primary' : 'border-transparent text-ink hover:text-primary')}>
              <t.i className="h-4 w-4" />{t.l}</button>)}
          </div>
        </div>
      </Card>
      {tab === 'overview' && <><AboutCard p={p} self={self} /><ProfessionalCard p={p} self={self} /><EducationCard p={p} self={self} />
        {!!p.achievements.length && <AchievementsCard p={p} />}{!!p.extra_fields?.length && <Box title="Additional details" icon={UserRound}><ExtraFields items={p.extra_fields} fileHref={(k) => `/api/v1/custom-fields/alumni_profile/${p.id}/${k}/file`} /></Box>}</>}
      {tab === 'posts' && <Feed endpoint={`/api/v1/community/feed?author_id=${p.id}`} />}
      {tab === 'about' && <AboutTab p={p} self={self} />}
      {tab === 'experience' && <ExperienceCard p={p} self={self} />}
      {tab === 'education' && <EducationCard p={p} self={self} />}
      {tab === 'mentorship' && <MentorshipTab p={p} self={self} />}
      {tab === 'activity' && <ActivityTab p={p} />}
    </PortalPage>
  );
}

function Cover({ p, self }: { p: Detail; self?: boolean }) {
  const site = useSite();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const fallback = site.assets.dashboard_banner ?? site.assets.login_background;
  const src = p.cover ? photoUrl(p.cover, 1600) : fallback ? pickVariant(fallback, 1600) : null;
  const upload = async (f: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); await api('/api/v1/alumni/me/cover', { method: 'POST', body: fd }); qc.invalidateQueries({ queryKey: ['my-profile'] }); toast.success('Cover updated.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); }
  };
  return (
    <div className="relative h-44 bg-gradient-to-r from-navy to-primary sm:h-56">
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      {self && <>
        <Button size="sm" variant="outline" loading={busy} className="absolute end-4 top-4 border-0 bg-surface/95 text-ink shadow" onClick={() => file.current?.click()}><Camera />Change Cover</Button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      </>}
    </div>
  );
}

function PhotoBadge({ p, self }: { p: Detail; self?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    try { const fd = new FormData(); fd.append('file', f); await api('/api/v1/alumni/me/photo', { method: 'POST', body: fd }); qc.invalidateQueries({ queryKey: ['my-profile'] }); toast.success('Photo updated.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); }
  };
  return (
    <div className="relative -mt-20 shrink-0 self-start sm:-mt-24">
      <Avatar name={p.full_name} src={photoUrl(p.photo, 320)} size={164} className="ring-[6px] ring-surface" />
      {self && <>
        <button type="button" aria-label="Change photo" onClick={() => file.current?.click()} className="absolute bottom-3 end-3 grid h-10 w-10 place-items-center rounded-full bg-surface text-ink shadow ring-1 ring-line hover:text-primary"><Camera className="h-5 w-5" /></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      </>}
    </div>
  );
}

function HeaderActions({ p, self }: { p: Detail; self?: boolean }) {
  const nav = useNavigate();
  const confirm = useConfirm();
  const [reporting, setReporting] = useState(false);
  const a = usePersonActions(p as Person);
  if (self) return (
    <div className="flex gap-2">
      <Button variant="outline" className="border-primary/50 text-primary" onClick={() => nav('/portal/profile/edit/personal')}><Pencil />Edit Profile</Button>
      <Menu>
        <MenuTrigger asChild><Button variant="outline" size="icon" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => nav('/portal/profile/edit/privacy')}><Settings />Privacy settings</MenuItem>
          <MenuItem onSelect={() => nav('/portal/profile/edit/verification')}><CheckCircle2 />Verification</MenuItem>
          <MenuItem onSelect={() => { navigator.clipboard?.writeText(`${location.origin}/portal/alumni/${p.id}`); }}><Link2 />Copy profile link</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <PrimaryAction p={p as Person} size="md" />
      {p.connection !== 'accepted' && <Button variant="outline" onClick={() => a.message.mutate(undefined)} loading={a.message.isPending}><MessageSquareText />Message</Button>}
      <Menu>
        <MenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => a.follow.mutate(undefined)}>{p.following ? <><UserMinus />Unfollow</> : <><Star />Follow</>}</MenuItem>
          {p.connection === 'accepted' && <MenuItem onSelect={async () => { if (await confirm({ title: 'Remove connection', description: `You and ${p.full_name} will no longer be connected.`, confirmLabel: 'Remove', danger: true })) a.withdraw.mutate(undefined); }}><UserX />Remove connection</MenuItem>}
          <MenuSeparator />
          <MenuItem danger onSelect={() => setReporting(true)}><Flag />Report profile</MenuItem>
        </MenuContent>
      </Menu>
      {reporting && <ReportDialog id={p.id} name={p.full_name} onClose={() => setReporting(false)} />}
    </div>
  );
}

function Box({ title, icon: Icon, edit, children }: { title: string; icon: typeof Users; edit?: string; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 font-heading text-lg font-semibold text-ink"><Icon className="h-5 w-5 text-primary" />{title}</h2>
        {edit && <button onClick={() => nav(edit)} className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"><Pencil className="h-4 w-4" />Edit</button>}
      </div>
      {children}
    </Card>
  );
}

function AboutCard({ p, self }: { p: Detail; self?: boolean }) {
  return <Box title="About Me" icon={UserRound} edit={self ? '/portal/profile/edit/personal' : undefined}>
    {p.bio ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{p.bio}</p> : <p className="text-sm text-ink-muted">{self ? 'Add a short biography so batchmates know what you are up to.' : 'No biography yet.'}</p>}
  </Box>;
}

function ProfessionalCard({ p, self }: { p: Detail; self?: boolean }) {
  const rows: [string, ReactNode][] = [['Current Position', p.designation], ['Company', p.organization], ['Industry', p.industry], ['Location', place(p)],
    ['Website', p.website && <a href={p.website.startsWith('http') ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline"><Link2 className="h-4 w-4" />{p.website}</a>]];
  const shown = rows.filter(([, v]) => v);
  return <Box title="Professional Details" icon={Briefcase} edit={self ? '/portal/profile/edit/professional' : undefined}>
    {!shown.length ? <p className="text-sm text-ink-muted">Not shared.</p> : (
      <div className="flex flex-col gap-5 sm:flex-row">
        <dl className="grid flex-1 grid-cols-[140px_1fr] gap-y-2.5 text-[15px]">{shown.map(([k, v]) => <Fragment key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></Fragment>)}</dl>
        {p.organization && <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-line sm:w-48 sm:border-s sm:ps-5">
          <span className="grid h-16 w-16 place-items-center rounded-card bg-navy font-heading text-2xl font-bold text-white">{p.organization[0]}</span>
          <p className="text-center text-sm font-semibold text-ink">{p.organization}</p></div>}
      </div>
    )}
  </Box>;
}

function EducationCard({ p, self }: { p: Detail; self?: boolean }) {
  const site = useSite();
  const logo = site.assets.institution_logo;
  const items = [...p.education].sort((a, b) => Number(b.is_sst) - Number(a.is_sst));
  return <Box title="Education" icon={GraduationCap} edit={self ? '/portal/profile/edit/education' : undefined}>
    <ul className="divide-y divide-line">
      <li className="flex items-center gap-4 py-3 first:pt-0">
        {logo ? <img src={pickVariant(logo, 96)} alt="" className="h-12 w-12 shrink-0 object-contain" /> : <GraduationCap className="h-12 w-12 text-primary" />}
        <div><p className="font-semibold text-ink">{site.institution_name}</p>
          <p className="text-sm text-ink-muted">{[p.class_name, p.graduation_year && (p.kind === 'student' ? `graduating ${p.graduation_year}` : `Class of ${p.graduation_year}`), p.admission_year && `admitted ${p.admission_year}`].filter(Boolean).join(' • ')}</p></div>
      </li>
      {items.filter((e) => !e.is_sst).map((e) => (
        <li key={e.id} className="flex items-center gap-4 py-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><GraduationCap className="h-6 w-6" /></span>
          <div><p className="font-semibold text-ink">{e.institution}</p><p className="text-sm text-ink-muted">{[e.qualification, e.field_of_study].filter(Boolean).join(' in ')}{(e.start_year || e.end_year) && ` • ${e.start_year ?? '…'} – ${e.end_year ?? 'present'}`}</p></div>
        </li>
      ))}
    </ul>
  </Box>;
}

function ExperienceCard({ p, self }: { p: Detail; self?: boolean }) {
  return <Box title="Experience" icon={Briefcase} edit={self ? '/portal/profile/edit/experience' : undefined}>
    {!p.employment.length ? <p className="text-sm text-ink-muted">Not shared.</p> : (
      <ol className="relative space-y-5 border-s-2 border-line ps-5">
        {p.employment.map((e) => (
          <li key={e.id} className="relative"><span className="absolute -start-[27px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-surface" />
            <p className="font-semibold text-ink">{e.designation}</p><p className="text-sm text-ink">{e.organization}{e.industry ? ` • ${e.industry}` : ''}</p>
            <p className="text-xs text-ink-muted">{[e.start_date && `${monthYear(e.start_date)} – ${e.is_current ? 'Present' : monthYear(e.end_date)}`, e.location].filter(Boolean).join(' • ')}</p>
            {e.description && <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">{e.description}</p>}</li>
        ))}
      </ol>
    )}
  </Box>;
}

function AchievementsCard({ p }: { p: Detail }) {
  return <Box title="Achievements" icon={Award}>
    <ul className="divide-y divide-line">{p.achievements.map((a) => (
      <li key={a.id} className="py-3 first:pt-0"><p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{a.title}<Badge tone="primary">{ACHIEVEMENT_KINDS.find(([k]) => k === a.kind)?.[1] ?? a.kind}</Badge></p>
        <p className="text-sm text-ink-muted">{[a.issuer, a.year].filter(Boolean).join(' • ')}</p>{a.description && <p className="mt-1 text-sm text-ink-muted">{a.description}</p>}</li>))}</ul>
  </Box>;
}

function AboutTab({ p, self }: { p: Detail; self?: boolean }) {
  const rows: [string, ReactNode][] = [['Batch', classLabel(p)], ['Email', p.email], ['Phone', p.phone], ['Birthday', p.date_of_birth && fmtDate(p.date_of_birth)],
    ['LinkedIn', p.linkedin && <a href={p.linkedin.startsWith('http') ? p.linkedin : `https://${p.linkedin}`} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{p.linkedin}</a>],
    ['Member since', fmtDate(p.member_since)], ['Followers', p.followers], ['Connections', p.connections]];
  return <>
    <AboutCard p={p} self={self} />
    <Box title="Details" icon={UserRound} edit={self ? '/portal/profile/edit/personal' : undefined}>
      <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-[15px]">{rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <Fragment key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></Fragment>)}</dl>
    </Box>
    {!!p.skills.length && <Box title="Skills" icon={Star} edit={self ? '/portal/profile/edit/professional' : undefined}><div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}</div></Box>}
  </>;
}

type Mentor = { status: string; industry: string | null; expertise: string[]; introduction: string; hours_per_month: number; formats: string[]; active_mentees: number; max_mentees: number; available: boolean };
function MentorshipTab({ p, self }: { p: Detail; self?: boolean }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['mentor-of', p.id], retry: false, queryFn: () => get<Mentor>(`/api/v1/mentorship/mentors/${p.id}`) });
  if (q.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!q.data) return <Card><EmptyState icon={UsersRound} title={self ? 'You are not a mentor yet' : `${p.full_name.split(' ')[0]} is not a mentor`}
    description={self ? 'Share your experience with students and young alumni.' : undefined}
    action={self ? <Button onClick={() => nav('/portal/mentorship')}>Become a Mentor</Button> : undefined} /></Card>;
  const m = q.data;
  return <Box title="Mentor profile" icon={UsersRound}>
    <p className="whitespace-pre-line text-[15px] text-ink">{m.introduction}</p>
    <div className="mt-3 flex flex-wrap gap-1.5">{m.expertise.map((x) => <Badge key={x} tone="primary">{x}</Badge>)}</div>
    <p className="mt-3 text-sm text-ink-muted">{m.industry} • about {m.hours_per_month} h / month • {m.active_mentees} of {m.max_mentees} places taken</p>
    {!self && m.available && <Button className="mt-4" onClick={() => nav('/portal/mentorship')}>Request Mentorship</Button>}
  </Box>;
}

function ActivityTab({ p }: { p: Detail }) {
  const q = useQuery({ queryKey: ['profile-activity', p.id], queryFn: () => get<{ type: 'post' | 'comment'; at: string; post_id: string; text: string; on?: string }[]>(`/api/v1/alumni/profiles/${p.id}/activity`) });
  return <Box title="Activity" icon={Activity}>
    {q.isLoading ? <Skeleton className="h-32" /> : !q.data?.length ? <p className="text-sm text-ink-muted">No recent activity.</p> : (
      <ul className="divide-y divide-line">{q.data.map((x, i) => (
        <li key={i} className="py-3 first:pt-0"><Link to={`/portal/community/posts/${x.post_id}`} className="group block">
          <p className="text-xs text-ink-muted">{x.type === 'post' ? 'Posted' : 'Commented'} • {timeAgo(x.at)}</p>
          <p className="line-clamp-2 text-sm text-ink group-hover:text-primary">{x.text}</p>
          {x.on && <p className="truncate text-xs text-ink-muted">on “{x.on}”</p>}</Link></li>))}</ul>
    )}
  </Box>;
}

function ProfileAside({ p, self, mine, ov }: { p: Detail; self?: boolean; mine?: Mine; ov?: Overview }) {
  const nav = useNavigate();
  return (
    <>
      {self && mine && (
        <Card className="p-5">
          <div className="flex items-center justify-between"><h2 className="font-heading text-lg font-semibold text-ink">Profile Completion</h2><span className="font-heading text-lg font-semibold text-primary">{mine.completion}%</span></div>
          <div className="mt-2 h-2 rounded-full bg-primary-soft"><div className="h-full rounded-full bg-primary" style={{ width: `${mine.completion}%` }} /></div>
          <ul className="mt-4 space-y-2">{mine.completion_items.map((c) => (
            <li key={c.key}><button onClick={() => !c.done && nav(`/portal/profile/edit/${c.tab}`)} className={cn('flex w-full items-center gap-2.5 text-start text-sm', c.done ? 'text-ink' : 'text-ink-muted hover:text-primary')}>
              {c.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : <Circle className="h-5 w-5 shrink-0 text-line" />}{c.label}</button></li>))}</ul>
          {mine.completion < 100 && <Button variant="outline" className="mt-4 w-full border-primary/50 text-primary" onClick={() => nav(`/portal/profile/edit/${mine.completion_items.find((c) => !c.done)?.tab ?? 'personal'}`)}>Complete Profile</Button>}
        </Card>
      )}
      <SectionCard title={self ? 'My Network' : 'Network'} icon={Users} action={<span className="text-sm font-semibold text-primary">{plural(ov?.connection_count ?? p.connections, 'Connection')}</span>}>
        {ov && ov.connections.length > 0 ? (
          <div className="flex -space-x-2">{ov.connections.map((c) => <Link key={c.id} to={`/portal/alumni/${c.id}`} title={c.full_name}><Avatar name={c.full_name} src={photoUrl(c.photo, 96)} size={44} className="ring-2 ring-surface" /></Link>)}
            {ov.connection_count > ov.connections.length && <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary ring-2 ring-surface">+{ov.connection_count - ov.connections.length}</span>}</div>
        ) : <p className="text-sm text-ink-muted">No connections yet.</p>}
        {self && <Button variant="outline" className="mt-4 w-full border-primary/50 text-primary" onClick={() => nav('/portal/network')}>Manage Network<ArrowRight className="rtl:rotate-180" /></Button>}
      </SectionCard>
      {!!ov?.communities.length && (
        <SectionCard title={self ? 'My Communities' : 'Communities'} icon={UsersRound} action={<span className="text-sm font-semibold text-primary">{plural(ov.communities.length, 'Community', 'Communities')}</span>}>
          <ul className="divide-y divide-line">{ov.communities.slice(0, 4).map((g) => (
            <li key={g.id}><Link to={`/portal/community/groups/${g.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
              {g.cover ? <img src={photoUrl(g.cover, 96) ?? ''} alt="" className="h-11 w-11 shrink-0 rounded-btn object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><UsersRound className="h-5 w-5" /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{g.name}</span><span className="block text-xs text-ink-muted">{g.member_count.toLocaleString()} members</span></span>
              <ArrowRight className="h-4 w-4 text-ink-muted rtl:rotate-180" /></Link></li>))}</ul>
          <Button variant="outline" className="mt-3 w-full border-primary/50 text-primary" onClick={() => nav('/portal/community/groups')}>View All Communities<ArrowRight className="rtl:rotate-180" /></Button>
        </SectionCard>
      )}
      <SectionCard title="Photos & Memories" icon={ImageIcon} action={<span className="text-sm font-semibold text-primary">{plural(ov?.photo_count ?? 0, 'Photo')}</span>}>
        {!ov?.photos.length ? <p className="text-sm text-ink-muted">Photos shared in posts appear here.</p> : (
          <div className="grid grid-cols-4 gap-1.5">{ov.photos.slice(0, 4).map((ph, i) => (
            <div key={ph.url} className="relative aspect-square overflow-hidden rounded-btn"><img src={photoUrl(ph, 240) ?? ''} alt="" className="h-full w-full object-cover" />
              {i === 3 && ov.photo_count > 4 && <span className="absolute inset-0 grid place-items-center bg-navy-dark/55 font-semibold text-white">+{ov.photo_count - 4}</span>}</div>))}</div>
        )}
      </SectionCard>
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

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

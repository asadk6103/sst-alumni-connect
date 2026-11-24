import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Check, Clock, Globe2, GraduationCap, Inbox, KeyRound, MapPinned, Phone, Search, ShieldAlert,
  Sparkles, UserCog, UserPlus, Users, X } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { classLabel, headline, type PersonCard } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader, EmptyState, Progress, Skeleton, StatTile } from '@/components/ui/display';
import { PersonAvatar, PersonTile, VerifiedBadge } from '@/components/alumni';

type Stats = {
  registered_alumni: number; verified_alumni: number; students: number; countries: number; batches: number; new_last_30_days: number;
  by_country: { country: string; count: number }[]; by_year: { year: number; count: number }[];
};
type Dash = {
  widgets: { key: string; title: string }[];
  me: {
    full_name: string; kind: string; graduation_year: number | null; batch: string | null; verification_status: string;
    rejection_reason: string | null; completion: number; next_steps: { key: string; label: string; tab: string }[];
    phone_verified: boolean; phone_verification_required: boolean;
  };
  stats?: Stats;
  requests?: { total: number; items: (PersonCard & { request_id: string; message: string | null; since: string })[] };
  suggestions?: PersonCard[];
};

export function PortalDashboard() {
  const q = useQuery({ queryKey: ['alumni-dashboard'], queryFn: () => get<Dash>('/api/v1/alumni/dashboard') });
  const d = q.data;
  if (q.isLoading || !d) {
    return <div className="grid gap-5 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className={cn('h-44 rounded-card', i === 0 && 'lg:col-span-3')} />)}</div>;
  }
  const has = (k: string) => d.widgets.some((w) => w.key === k);
  // Full-width widgets first, then the two-column area.
  return (
    <div className="space-y-6">
      {has('welcome') && <Welcome d={d} />}
      {d.me.phone_verification_required && !d.me.phone_verified && (
        <Alert tone="warning" title="Verify your mobile number">
          Your organisation asks every member to confirm their mobile number. <Link to="/portal/account" className="font-medium text-primary underline">Verify now</Link>
        </Alert>
      )}
      {has('verification') && <Verification d={d} />}
      {has('stats') && d.stats && <StatsRow s={d.stats} />}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          {has('connection_requests') && d.requests && <Requests r={d.requests} />}
          {has('suggestions') && d.suggestions && <Suggestions items={d.suggestions} />}
          {(has('by_year') || has('by_country')) && d.stats && (
            <div className="grid gap-6 lg:grid-cols-2">
              {has('by_year') && <ByYear s={d.stats} />}
              {has('by_country') && <ByCountry s={d.stats} />}
            </div>
          )}
        </div>
        <div className="space-y-6">
          {has('profile_completion') && <Completion d={d} />}
          {has('quick_actions') && <QuickActions />}
        </div>
      </div>
    </div>
  );
}

function Welcome({ d }: { d: Dash }) {
  const site = useSite();
  const banner = site.assets.dashboard_banner;
  const first = d.me.full_name.split(' ')[0];
  return (
    <div className="relative overflow-hidden rounded-card bg-navy text-white">
      {banner && <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />}
      <div className="absolute inset-0 bg-gradient-to-r from-navy-dark/90 via-navy/70 to-transparent" />
      <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-sm text-white/75">{classLabel({ batch: d.me.batch, graduation_year: d.me.graduation_year, kind: d.me.kind as 'alumni' })}</p>
          <h1 className="mt-1 flex items-center gap-2 font-heading text-2xl font-semibold">Welcome back, {first}{d.me.verification_status === 'verified' && <BadgeCheck className="h-6 w-6 text-secondary" aria-label="Verified" />}</h1>
          <p className="mt-1 max-w-xl text-[15px] text-white/85">{site.branding.tagline}</p>
        </div>
        <Button asChild variant="outline-light"><Link to="/portal/directory"><Search />Find alumni</Link></Button>
      </div>
    </div>
  );
}

function Verification({ d }: { d: Dash }) {
  const rejected = d.me.verification_status === 'rejected';
  return (
    <Alert tone={rejected ? 'danger' : 'info'} title={rejected ? 'Your verification needs attention' : 'Your profile is waiting for verification'}>
      {rejected ? <>The alumni office could not verify your profile: “{d.me.rejection_reason}”. Correct your details and submit again. </>
        : <>The alumni office is confirming that you studied at the school. The directory and connections open once you are verified. You can speed it up with a code from the alumni office or a supporting document. </>}
      <Link to="/portal/profile/verification" className="font-medium text-primary underline">{rejected ? 'Review and resubmit' : 'Verification options'}</Link>
    </Alert>
  );
}

function StatsRow({ s }: { s: Stats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile icon={Users} value={s.registered_alumni.toLocaleString()} label="Registered alumni" trend={s.new_last_30_days ? { value: `+${s.new_last_30_days} this month`, up: true } : null} />
      <StatTile icon={BadgeCheck} tone="success" value={s.verified_alumni.toLocaleString()} label="Verified alumni" />
      <StatTile icon={Globe2} tone="navy" value={s.countries.toLocaleString()} label="Countries" />
      <StatTile icon={GraduationCap} tone="warning" value={s.batches.toLocaleString()} label="Batches represented" />
    </div>
  );
}

function Requests({ r }: { r: NonNullable<Dash['requests']> }) {
  const respond = useAction(({ id, action }: { id: string; action: 'accept' | 'decline' }) => api(`/api/v1/alumni/connections/${id}/${action}`, { method: 'POST' }),
    { success: (x) => ((x as { data: { status: string } }).data.status === 'accepted' ? 'You are now connected.' : 'Request declined.'), invalidate: [['alumni-dashboard'], ['connections']] });
  return (
    <Card>
      <CardHeader title="Connection requests" icon={Inbox} description={r.total ? `${r.total} waiting for your reply` : undefined}
        action={r.total > r.items.length && <Button asChild variant="link" size="sm"><Link to="/portal/connections">View all<ArrowRight /></Link></Button>} />
      {r.items.length === 0 ? <EmptyState icon={Inbox} title="No pending requests" description="Requests from other alumni will appear here." /> : (
        <ul className="divide-y divide-line">
          {r.items.map((p) => (
            <li key={p.request_id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <Link to={`/portal/alumni/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <PersonAvatar p={p} size={44} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium text-ink">{p.full_name}{p.verified && <VerifiedBadge />}</p>
                  <p className="truncate text-xs text-ink-muted">{[headline(p), classLabel(p)].filter(Boolean).join(' · ')}</p>
                  {p.message && <p className="mt-0.5 line-clamp-2 text-sm text-ink">“{p.message}”</p>}
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span className="mr-1 hidden text-xs text-ink-muted sm:block"><Clock className="mr-1 inline h-3 w-3" />{timeAgo(p.since)}</span>
                <Button size="sm" onClick={() => respond.mutate({ id: p.request_id, action: 'accept' })}><Check />Accept</Button>
                <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: p.request_id, action: 'decline' })}><X />Decline</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Suggestions({ items }: { items: PersonCard[] }) {
  return (
    <Card>
      <CardHeader title="People you may know" icon={Sparkles} description="Batchmates and alumni near you or in your field"
        action={<Button asChild variant="link" size="sm"><Link to="/portal/directory">Directory<ArrowRight /></Link></Button>} />
      {items.length === 0 ? <EmptyState icon={UserPlus} title="No suggestions yet" description="Complete your profile (batch, city, industry) to get better suggestions." /> : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 2xl:grid-cols-3">{items.map((p) => <PersonTile key={p.id} p={p} />)}</div>
      )}
    </Card>
  );
}

function Bars({ rows, max }: { rows: { label: string; count: number }[]; max: number }) {
  return (
    <ul className="space-y-2.5 p-5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_1fr_40px] items-center gap-3 text-sm">
          <span className="truncate text-ink" title={r.label}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-primary-soft"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} /></span>
          <span className="text-right tabular-nums text-ink-muted">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function ByCountry({ s }: { s: Stats }) {
  const max = Math.max(1, ...s.by_country.map((c) => c.count));
  return (
    <Card>
      <CardHeader title="Alumni by country" icon={MapPinned} />
      {s.by_country.length === 0 ? <EmptyState icon={MapPinned} title="No data yet" /> : <Bars rows={s.by_country.map((c) => ({ label: c.country, count: c.count }))} max={max} />}
    </Card>
  );
}

function ByYear({ s }: { s: Stats }) {
  const max = Math.max(1, ...s.by_year.map((c) => c.count));
  return (
    <Card>
      <CardHeader title="Alumni by graduation year" icon={GraduationCap} />
      {s.by_year.length === 0 ? <EmptyState icon={GraduationCap} title="No data yet" /> : (
        <div className="flex h-48 items-end gap-1.5 overflow-x-auto p-5" role="img" aria-label="Registered alumni per graduation year">
          {s.by_year.map((y) => (
            <div key={y.year} className="flex min-w-[26px] flex-1 flex-col items-center gap-1" title={`${y.year}: ${y.count}`}>
              <span className="text-[10px] text-ink">{y.count}</span>
              <div className="w-full max-w-[28px] rounded-t bg-primary/80" style={{ height: `${(y.count / max) * 110 + 4}px` }} />
              <span className="text-[10px] text-ink-muted">’{String(y.year).slice(2)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Completion({ d }: { d: Dash }) {
  const pct = d.me.completion;
  return (
    <Card>
      <CardHeader title="Profile completion" icon={UserCog} />
      <div className="p-5">
        <div className="flex items-end justify-between"><span className="font-heading text-3xl font-semibold text-ink">{pct}%</span>
          <span className="text-xs text-ink-muted">{pct === 100 ? 'Complete' : 'A complete profile gets more connections'}</span></div>
        <Progress value={pct} className="mt-3" label="Profile completion" />
        {d.me.next_steps.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {d.me.next_steps.map((s) => (
              <li key={s.key}><Link to={s.tab === 'account' ? '/portal/account' : `/portal/profile/${s.tab}`} className="flex items-center justify-between gap-2 rounded-btn px-2 py-1.5 text-sm text-ink hover:bg-canvas">
                {s.label}<ArrowRight className="h-4 w-4 text-ink-muted" /></Link></li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function QuickActions() {
  const { can } = useAuth();
  const items = [
    { to: '/portal/profile', label: 'Edit my profile', icon: UserCog, show: true },
    { to: '/portal/directory', label: 'Search the directory', icon: Search, show: can('portal.directory') },
    { to: '/portal/connections', label: 'My connections', icon: Users, show: can('portal.directory') },
    { to: '/portal/profile/privacy', label: 'Privacy settings', icon: ShieldAlert, show: true },
    { to: '/portal/account', label: 'Verify mobile number', icon: Phone, show: true },
    { to: '/portal/account/security', label: 'Password & security', icon: KeyRound, show: true },
  ].filter((i) => i.show);
  return (
    <Card>
      <CardHeader title="Quick actions" />
      <div className="grid grid-cols-2 gap-2 p-4">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex flex-col items-start gap-2 rounded-card border border-line p-3 text-sm font-medium text-ink hover:border-primary/40 hover:bg-primary-soft/40">
            <i.icon className="h-5 w-5 text-primary" />{i.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, CheckCircle2, Clock3, ShieldCheck, UserCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickVariant, useSite } from '@/lib/site';
import { timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/display';

type Dash = {
  users_total: number; users_by_status: Record<string, number>; staff: number; new_last_30_days: number; new_previous_30_days: number;
  active_last_7_days: number; registrations_by_month: { month: string; count: number }[];
  recent_activity: { id: number; summary: string; actor: string | null; created_at: string }[];
};
type Health = { checks: Record<string, { ok: boolean; ms: number; message: string }> };

function trend(now: number, prev: number) {
  if (!prev) return now ? { value: `+${now} this month`, up: true } : null;
  const pct = Math.round(((now - prev) / prev) * 100);
  return { value: `${pct >= 0 ? '+' : ''}${pct}% vs last month`, up: pct >= 0 };
}

export function AdminDashboard() {
  const { user, can } = useAuth();
  const site = useSite();
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => get<Dash>('/api/v1/admin/dashboard') });
  const health = useQuery({ queryKey: ['admin-health-brief'], queryFn: () => get<Health>('/api/v1/admin/health'), enabled: can('health.view') });
  const d = q.data;
  const banner = site.assets.dashboard_banner;
  const maxMonth = Math.max(1, ...(d?.registrations_by_month.map((m) => m.count) ?? [1]));

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome back, ${user?.full_name.split(' ')[0]}. Here is what's happening on ${site.app_name}.`} />
      {banner && (
        <div className="relative mb-6 h-36 overflow-hidden rounded-card">
          <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy-dark/85 to-transparent" />
          <p className="absolute bottom-5 left-6 font-heading text-xl font-semibold text-white">{site.app_name}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {q.isLoading || !d ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-card" />) : (
          <>
            <StatTile icon={Users} value={d.users_total.toLocaleString()} label="Registered accounts" trend={trend(d.new_last_30_days, d.new_previous_30_days)} />
            <StatTile icon={UserCheck} tone="success" value={(d.users_by_status.active ?? 0).toLocaleString()} label="Active accounts" />
            <StatTile icon={UserPlus} tone="warning" value={(d.users_by_status.pending ?? 0).toLocaleString()} label="Pending verification" />
            <StatTile icon={Activity} tone="navy" value={d.active_last_7_days.toLocaleString()} label="Signed in, last 7 days" />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Registrations" icon={UserPlus} description="New accounts per month, last 12 months" />
          <div className="p-5">
            {!d ? <Skeleton className="h-44" /> : d.registrations_by_month.length === 0 ? (
              <EmptyState icon={UserPlus} title="No registrations yet" description="Accounts created in the last year will be charted here." />
            ) : (
              <div className="flex h-44 items-end gap-2" role="img" aria-label="Registrations per month">
                {d.registrations_by_month.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[11px] font-medium text-ink">{m.count}</span>
                    <div className="w-full max-w-[38px] rounded-t-md bg-primary/80" style={{ height: `${(m.count / maxMonth) * 120 + 4}px` }} />
                    <span className="text-[11px] text-ink-muted">{new Date(`${m.month}-01`).toLocaleString(undefined, { month: 'short' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="System status" icon={ShieldCheck} action={can('health.view') && <Button asChild variant="link" size="sm"><Link to="/admin/health">Details<ArrowRight /></Link></Button>} />
          <ul className="divide-y divide-line">
            {can('health.view') ? (health.data ? Object.entries(health.data.checks).map(([k, c]) => (
              <li key={k} className="flex items-center gap-3 px-5 py-3 text-sm">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />}
                <span className="w-20 font-medium capitalize text-ink">{k}</span>
                <span className="truncate text-ink-muted">{c.message}</span>
              </li>
            )) : Array.from({ length: 4 }).map((_, i) => <li key={i} className="px-5 py-3"><Skeleton className="h-4" /></li>))
              : <li className="px-5 py-4 text-sm text-ink-muted">You do not have access to system health.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent activity" icon={Clock3} action={can('audit.view') && <Button asChild variant="link" size="sm"><Link to="/admin/audit">View all<ArrowRight /></Link></Button>} />
        {!d ? <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div> : d.recent_activity.length === 0 ? (
          <EmptyState icon={Clock3} title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {d.recent_activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="min-w-0 truncate text-ink"><span className="font-medium">{a.actor ?? 'System'}</span> · {a.summary}</span>
                <span className="shrink-0 text-xs text-ink-muted">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

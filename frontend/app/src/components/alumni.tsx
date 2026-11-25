import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Award, BadgeCheck, Briefcase, Check, Clock, ExternalLink, GraduationCap, Linkedin, Mail, MapPin, Phone, Star, UserCheck,
  UserMinus, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { ACHIEVEMENT_KINDS, classLabel, headline, monthYear, photoUrl, place, type PersonCard, type ProfileDetail } from '@/lib/alumni';
import { cn, fmtDate } from '@/lib/utils';
import { ExtraFields } from '@/components/customFields';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardHeader, EmptyState } from '@/components/ui/display';

export function VerifiedBadge({ className, label = false }: { className?: string; label?: boolean }) {
  return (
    <span title="Verified alumni" className={cn('inline-flex items-center gap-1 text-primary', className)}>
      <BadgeCheck className="h-4 w-4" aria-label="Verified" />{label && <span className="text-xs font-medium">Verified</span>}
    </span>
  );
}

export function PersonAvatar({ p, size = 48 }: { p: Pick<PersonCard, 'full_name' | 'photo'>; size?: number }) {
  return <Avatar name={p.full_name} src={photoUrl(p.photo, size * 2)} size={size} />;
}

const REFRESH = [['directory'], ['connections'], ['alumni-profile'], ['alumni-dashboard']];

/** Connect / pending / accept / connected + follow, as one compact control. */
export function RelationActions({ p, compact, showFollow = true }: { p: PersonCard; compact?: boolean; showFollow?: boolean }) {
  const { can } = useAuth();
  const connect = useAction(() => api('/api/v1/alumni/connections', { method: 'POST', body: { user_id: p.id } }),
    { success: 'Connection request sent.', invalidate: REFRESH });
  const respond = useAction((action: 'accept' | 'decline') => api(`/api/v1/alumni/connections/${p.connection_id}/${action}`, { method: 'POST' }),
    { success: (r) => ((r as { data: { status: string } }).data.status === 'accepted' ? 'You are now connected.' : 'Request declined.'), invalidate: REFRESH });
  const withdraw = useAction(() => api(`/api/v1/alumni/connections/${p.connection_id}`, { method: 'DELETE' }),
    { success: 'Request withdrawn.', invalidate: REFRESH });
  const follow = useAction(() => api(`/api/v1/alumni/profiles/${p.id}/follow`, { method: p.following ? 'DELETE' : 'POST' }),
    { invalidate: REFRESH });
  if (!can('portal.connect')) return null;
  const size = compact ? 'sm' : 'md';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.connection === 'accepted' ? <Button size={size} variant="secondary" disabled><UserCheck />Connected</Button>
        : p.connection === 'sent' ? <Button size={size} variant="outline" loading={withdraw.isPending} onClick={() => withdraw.mutate(undefined)} title="Withdraw request"><Clock />Pending</Button>
        : p.connection === 'received' ? (<>
            <Button size={size} loading={respond.isPending} onClick={() => respond.mutate('accept')}><Check />Accept</Button>
            <Button size={size} variant="outline" onClick={() => respond.mutate('decline')}><X />Decline</Button>
          </>)
        : <Button size={size} loading={connect.isPending} onClick={() => connect.mutate(undefined)}><UserPlus />Connect</Button>}
      {showFollow && (
        <Button size={size} variant="ghost" loading={follow.isPending} onClick={() => follow.mutate(undefined)} aria-pressed={p.following}>
          {p.following ? <><UserMinus />Unfollow</> : <><Star />Follow</>}
        </Button>
      )}
    </div>
  );
}

/** Directory card in grid or list layout. */
export function PersonTile({ p, view = 'grid', onPreview, actions }: { p: PersonCard; view?: 'grid' | 'list'; onPreview?: (p: PersonCard) => void; actions?: ReactNode }) {
  const name = (
    <Link to={`/portal/alumni/${p.id}`} className="font-heading font-semibold text-ink hover:text-primary" onClick={(e) => { if (onPreview) { e.preventDefault(); onPreview(p); } }}>
      {p.full_name}
    </Link>
  );
  const meta = [classLabel(p), place(p)].filter(Boolean);
  if (view === 'list') {
    return (
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PersonAvatar p={p} size={48} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate">{name}{p.verified && <VerifiedBadge />}{p.kind === 'student' && <Badge>Student</Badge>}</p>
            {headline(p) && <p className="truncate text-sm text-ink">{headline(p)}</p>}
            {meta.length > 0 && <p className="truncate text-xs text-ink-muted">{meta.join(' · ')}</p>}
            {p.reason && <p className="text-xs text-primary">{p.reason}</p>}
          </div>
        </div>
        {actions ?? <RelationActions p={p} compact />}
      </div>
    );
  }
  return (
    <Card className="flex flex-col items-center p-5 text-center">
      <PersonAvatar p={p} size={84} />
      <p className="mt-3 flex items-center gap-1.5">{name}{p.verified && <VerifiedBadge />}</p>
      {p.kind === 'student' && <Badge className="mt-1">Student</Badge>}
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-ink">{headline(p) ?? <span className="text-ink-muted">—</span>}</p>
      <div className="mt-2 space-y-0.5 text-xs text-ink-muted">
        {classLabel(p) && <p className="flex items-center justify-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{classLabel(p)}</p>}
        {place(p) && <p className="flex items-center justify-center gap-1"><MapPin className="h-3.5 w-3.5" />{place(p)}</p>}
      </div>
      {p.reason && <p className="mt-2 text-xs font-medium text-primary">{p.reason}</p>}
      <div className="mt-auto pt-4">{actions ?? <RelationActions p={p} compact showFollow={false} />}</div>
    </Card>
  );
}

/** Profile header + sections; the API already removed anything the viewer may not see. */
export function ProfileBody({ p, header = true, actions }: { p: ProfileDetail; header?: boolean; actions?: ReactNode }) {
  const contact = [
    p.email && { icon: Mail, label: p.email, href: `mailto:${p.email}` },
    p.phone && { icon: Phone, label: p.phone, href: `tel:${p.phone}` },
    p.linkedin && { icon: Linkedin, label: 'LinkedIn', href: p.linkedin },
    p.website && { icon: ExternalLink, label: p.website.replace(/^https?:\/\//, ''), href: p.website },
  ].filter(Boolean) as { icon: typeof Mail; label: string; href: string }[];
  const sst = p.education.filter((e) => e.is_sst);
  const higher = p.education.filter((e) => !e.is_sst);
  return (
    <div className="space-y-5">
      {header && (
        <Card className="overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-navy to-primary" />
          <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
            <div className="-mt-12 rounded-full border-4 border-surface bg-surface"><PersonAvatar p={p} size={104} /></div>
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 font-heading text-xl font-semibold text-ink">
                {p.full_name}{p.verified && <VerifiedBadge label />}{p.kind === 'student' && <Badge>Student</Badge>}
              </h1>
              {headline(p) && <p className="text-[15px] text-ink">{headline(p)}</p>}
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                {classLabel(p) && <span className="flex items-center gap-1"><GraduationCap className="h-4 w-4" />{classLabel(p)}</span>}
                {place(p) && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{place(p)}</span>}
                <span>{p.connections} connection{p.connections === 1 ? '' : 's'} · {p.followers} follower{p.followers === 1 ? '' : 's'}</span>
              </p>
            </div>
            {actions}
          </div>
        </Card>
      )}
      <div className={cn("grid gap-5", header && "lg:grid-cols-[1fr_300px]")}>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="About" />
            <p className="whitespace-pre-line p-5 text-sm leading-relaxed text-ink">{p.bio || <span className="text-ink-muted">No biography yet.</span>}</p>
          </Card>
          <Card>
            <CardHeader title="Experience" icon={Briefcase} />
            {p.employment.length === 0 ? <p className="p-5 text-sm text-ink-muted">Not shared.</p> : (
              <ul className="divide-y divide-line">
                {p.employment.map((e) => (
                  <li key={e.id} className="px-5 py-4">
                    <p className="font-medium text-ink">{e.designation}</p>
                    <p className="text-sm text-ink">{e.organization}{e.industry ? ` · ${e.industry}` : ''}</p>
                    <p className="text-xs text-ink-muted">{[e.start_date && `${monthYear(e.start_date)} – ${e.is_current ? 'Present' : monthYear(e.end_date)}`, e.location].filter(Boolean).join(' · ')}</p>
                    {e.description && <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">{e.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Education" icon={GraduationCap} />
            <ul className="divide-y divide-line">
              <li className="px-5 py-4">
                <p className="font-medium text-ink">SST academic history</p>
                <p className="text-sm text-ink-muted">
                  {[p.admission_year && `Admitted ${p.admission_year}`, p.graduation_year && (p.kind === 'student' ? `graduating ${p.graduation_year}` : `graduated ${p.graduation_year}`), p.class_name].filter(Boolean).join(' · ') || '—'}
                </p>
              </li>
              {[...sst, ...higher].map((e) => (
                <li key={e.id} className="px-5 py-4">
                  <p className="font-medium text-ink">{e.qualification}{e.field_of_study ? `, ${e.field_of_study}` : ''}</p>
                  <p className="text-sm text-ink">{e.institution}</p>
                  {(e.start_year || e.end_year) && <p className="text-xs text-ink-muted">{e.start_year ?? '…'} – {e.end_year ?? 'present'}</p>}
                </li>
              ))}
            </ul>
          </Card>
          {!!p.extra_fields?.length && (
            <Card>
              <CardHeader title="Additional details" />
              <ExtraFields className="p-5" items={p.extra_fields} fileHref={(k) => `/api/v1/custom-fields/alumni_profile/${p.id}/${k}/file`} />
            </Card>
          )}
          {p.achievements.length > 0 && (
            <Card>
              <CardHeader title="Achievements" icon={Award} />
              <ul className="divide-y divide-line">
                {p.achievements.map((a) => (
                  <li key={a.id} className="px-5 py-4">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">{a.title}<Badge tone="primary">{ACHIEVEMENT_KINDS.find(([k]) => k === a.kind)?.[1] ?? a.kind}</Badge></p>
                    <p className="text-sm text-ink-muted">{[a.issuer, a.year].filter(Boolean).join(' · ')}</p>
                    {a.description && <p className="mt-1 text-sm text-ink-muted">{a.description}</p>}
                    {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">View<ExternalLink className="h-3.5 w-3.5" /></a>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            {contact.length === 0 ? <p className="p-5 text-sm text-ink-muted">Contact details are private.</p> : (
              <ul className="space-y-2.5 p-5 text-sm">
                {contact.map((c) => (
                  <li key={c.href}><a href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer nofollow"
                    className="flex items-center gap-2 break-all text-ink hover:text-primary"><c.icon className="h-4 w-4 shrink-0 text-ink-muted" />{c.label}</a></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Skills" />
            {p.skills.length === 0 ? <p className="p-5 text-sm text-ink-muted">No skills listed.</p>
              : <div className="flex flex-wrap gap-1.5 p-5">{p.skills.map((s) => <Badge key={s} tone="primary">{s}</Badge>)}</div>}
          </Card>
          {p.verified_at && <p className="px-1 text-xs text-ink-muted">Verified alumni since {fmtDate(p.verified_at)}</p>}
        </div>
      </div>
    </div>
  );
}

export function NoAccess({ title = 'Available to verified alumni', children }: { title?: string; children?: ReactNode }) {
  return (
    <Card>
      <EmptyState icon={BadgeCheck} title={title}
        description={children ?? 'The directory and connections open once your profile is verified by the alumni office.'}
        action={<Button asChild><Link to="/portal/profile/verification">Check verification status</Link></Button>} />
    </Card>
  );
}

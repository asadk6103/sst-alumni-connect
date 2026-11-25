import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Bookmark, BookmarkCheck, Briefcase, CalendarDays, ChevronDown, EyeOff, FileText, Flag, Hash, ImagePlus, Link2, Loader2,
  MapPin, Megaphone, MessageCircle, MoreHorizontal, Pencil, Pin, Plus, Repeat2, Send, Smile, ThumbsUp, Trash2, Trophy, UserPlus, Users, Video, X,
} from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl, type Photo } from '@/lib/alumni';
import { useRoom } from '@/lib/live';
import { cn, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import { VerifiedBadge } from '@/components/alumni';

export type Author = { id: string; full_name: string; photo: Photo; verified: boolean; headline: string | null; batch: string | null; staff: boolean };
type MediaT = { id: string; url: string; mime?: string; variants: { width: number; url: string }[]; width: number | null; height: number | null; alt: string };
export type PollT = { question: string; multiple: boolean; closes_at: string | null; closed: boolean; voters: number; my_votes: string[];
  options: { id: string; label: string; votes: number; percent: number }[] };
export type PostT = {
  id: string; kind: 'post' | 'announcement' | 'share' | 'achievement' | 'article' | 'poll' | 'event' | 'job'; title: string | null; body: string;
  status: string; moderation_reason: string | null; author: Author | null; group: { id: string; name: string; kind: string } | null;
  media: MediaT[]; shared_post: PostT | null; shared_unavailable: boolean; is_pinned: boolean; comment_count: number; reaction_count: number;
  share_count: number; reactions: Record<string, number>; my_reaction: string | null; created_at: string; edited_at: string | null;
  can_edit: boolean; can_delete: boolean; audience: 'community' | 'connections'; location: string | null; feeling: string | null; topics: string[];
  tagged: Author[]; mentions: Author[]; poll: PollT | null; saved: boolean;
  event: { id: string; title: string; kind: string; starts_at: string; venue: string | null; is_online: boolean; banner: { url: string } | null } | null;
  job: { id: string; title: string; organization: string; employment_type: string; location: string } | null;
};
export type CommentT = { id: string; post_id: string; parent_id: string | null; body: string; status: string; author: Author | null;
  created_at: string; edited_at: string | null; can_edit: boolean; can_delete: boolean; replies?: CommentT[]; mentions: Author[];
  reactions: Record<string, number>; reaction_count: number; my_reaction: string | null };
export type GroupT = { id: string; name: string; description: string; kind: 'batch' | 'interest' | 'forum'; join_policy: 'open' | 'approval';
  status: string; member_count: number; post_count: number; last_post_at: string | null; cover: Photo; batch_id: string | null;
  membership: { role: string; status: string } | null; can_manage: boolean; readable?: boolean };
type FeedPage = { data: PostT[]; meta: { next_cursor: string | null; pinned: PostT[] } };

export const REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: 'like', emoji: '👍', label: 'Like' }, { key: 'love', emoji: '❤️', label: 'Love' }, { key: 'celebrate', emoji: '👏', label: 'Celebrate' },
  { key: 'insightful', emoji: '💡', label: 'Insightful' }, { key: 'haha', emoji: '😆', label: 'Haha' }, { key: 'support', emoji: '💜', label: 'Support' },
];
const FEELINGS = ['happy', 'grateful', 'proud', 'excited', 'nostalgic', 'motivated', 'thankful', 'blessed'];
const INVALIDATE = [['feed'], ['post'], ['admin-community'], ['saved'], ['drafts']];

/** Plain text with clickable links, highlighted @mentions and #topics (never rendered as HTML). */
export function RichText({ text, className, mentions = [] }: { text: string; className?: string; mentions?: Author[] }) {
  const names = mentions.map((m) => m.full_name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(https?://[^\\s<]+${names.length ? `|@(?:${names.join('|')})` : ''}|#[\\w\\u0600-\\u06FF]+)`, 'g');
  const parts = text.split(re);
  return (
    <p className={cn('whitespace-pre-line break-words text-[15px] leading-relaxed text-ink', className)}>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline-offset-2 hover:underline">{p}</a>;
        if (p.startsWith('@')) { const m = mentions.find((x) => `@${x.full_name}` === p); if (m) return <Link key={i} to={`/portal/alumni/${m.id}`} className="font-medium text-primary hover:underline">{p}</Link>; }
        if (/^#[\w؀-ۿ]+$/.test(p)) return <span key={i} className="font-medium text-primary">{p}</span>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </p>
  );
}

function AuthorLine({ post }: { post: PostT }) {
  const a = post.author;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link to={a ? `/portal/alumni/${a.id}` : '#'} className="shrink-0"><Avatar name={a?.full_name} src={photoUrl(a?.photo ?? null, 96)} size={46} /></Link>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] leading-tight">
          {a ? <Link to={`/portal/alumni/${a.id}`} className="font-semibold text-ink hover:text-primary">{a.full_name}</Link> : <span className="font-semibold text-ink-muted">Former member</span>}
          {a?.verified && <VerifiedBadge />}{a?.staff && <Badge tone="navy">Alumni office</Badge>}
          {post.feeling && <span className="text-sm font-normal text-ink-muted">is feeling {post.feeling}</span>}
          {post.tagged.length > 0 && <span className="text-sm font-normal text-ink-muted">with {post.tagged.map((t, i) => <Fragment key={t.id}>{i > 0 && (i === post.tagged.length - 1 ? ' and ' : ', ')}<Link to={`/portal/alumni/${t.id}`} className="font-medium text-ink hover:text-primary">{t.full_name}</Link></Fragment>)}</span>}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
          {[a?.batch, post.location].filter(Boolean).join(' • ')}{(a?.batch || post.location) && ' • '}
          <time dateTime={post.created_at} title={fmtDateTime(post.created_at)}>{timeAgo(post.created_at)}</time>{post.edited_at && ' • edited'}
          {post.audience === 'connections' && <> • <Users className="inline h-3 w-3" aria-label="Connections only" /></>}
        </p>
      </div>
    </div>
  );
}

function Gallery({ media }: { media: MediaT[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const pick = (m: MediaT, w: number) => m.variants.find((v) => v.width >= w)?.url ?? m.url;
  const isVideo = (m: MediaT) => m.mime?.startsWith('video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(m.url);
  const n = media.length;
  const cell = (m: MediaT, i: number, cls: string, w: number) => isVideo(m)
    ? <video key={m.id} src={m.url} controls preload="metadata" className={cn('w-full rounded-[10px] bg-black object-cover', cls)} />
    : (
      <button key={m.id} onClick={() => setOpen(i)} className={cn('relative block overflow-hidden rounded-[10px] bg-canvas', cls)} aria-label="Open photo">
        <img src={pick(m, w)} alt={m.alt} loading="lazy" className="h-full w-full object-cover" />
        {i === (n > 3 ? 2 : -1) && n > 3 && <span className="absolute inset-0 grid place-items-center bg-navy-dark/55 text-2xl font-semibold text-white">+{n - 3}</span>}
      </button>
    );
  return (
    <>
      {n === 1 ? <div className="mt-3">{cell(media[0]!, 0, 'max-h-[460px]', 1200)}</div>
        : n === 2 ? <div className="mt-3 grid grid-cols-2 gap-1.5">{media.map((m, i) => cell(m, i, 'aspect-[4/3]', 640))}</div>
          : (
            <div className="mt-3 grid grid-cols-[1.6fr_1fr] gap-1.5">
              {cell(media[0]!, 0, 'h-full min-h-[220px]', 1200)}
              <div className="grid gap-1.5">{media.slice(1, 3).map((m, i) => cell(m, i + 1, 'aspect-[4/3]', 480))}</div>
            </div>
          )}
      {open !== null && media[open] && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-dark/90 p-4" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(null)}>
          <img src={pick(media[open], 1920)} alt={media[open].alt} className="max-h-full max-w-full rounded-card" />
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Close"><X /></button>
        </div>
      )}
    </>
  );
}

function PollView({ post }: { post: PostT }) {
  const poll = post.poll!;
  const [p, setP] = useState(poll);
  const [pick, setPick] = useState<string[]>(poll.my_votes);
  const vote = useAction((ids: string[]) => api<{ data: PollT }>(`/api/v1/community/posts/${post.id}/vote`, { method: 'PUT', body: { option_ids: ids } }),
    { onSuccess: (r) => { setP(r.data); setPick(r.data.my_votes); } });
  const voted = p.my_votes.length > 0;
  const show = voted || p.closed;
  return (
    <div className="mt-3 rounded-card border border-line p-4">
      <p className="flex items-center gap-2 font-medium text-ink"><BarChart3 className="h-4 w-4 text-primary" />{p.question}</p>
      <div className="mt-3 space-y-2">
        {p.options.map((o) => {
          const mine = p.my_votes.includes(o.id);
          return show ? (
            <button key={o.id} type="button" disabled={p.closed} onClick={() => !p.closed && vote.mutate(p.multiple ? (mine ? p.my_votes.filter((x) => x !== o.id) : [...p.my_votes, o.id]) : [o.id])}
              className="relative block w-full overflow-hidden rounded-btn border border-line text-start text-sm">
              <span className={cn('absolute inset-y-0 start-0', mine ? 'bg-primary/20' : 'bg-canvas')} style={{ width: `${o.percent}%` }} />
              <span className="relative flex justify-between px-3 py-2"><span className={cn(mine && 'font-semibold text-primary')}>{o.label}{mine && ' ✓'}</span><span className="tabular-nums text-ink-muted">{o.percent}%</span></span>
            </button>
          ) : (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm hover:border-primary">
              <input type={p.multiple ? 'checkbox' : 'radio'} name={`poll-${post.id}`} checked={pick.includes(o.id)} className="accent-[rgb(var(--primary))]"
                onChange={() => setPick(p.multiple ? (pick.includes(o.id) ? pick.filter((x) => x !== o.id) : [...pick, o.id]) : [o.id])} />{o.label}
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
        <span>{p.voters} vote{p.voters === 1 ? '' : 's'}{p.closed ? ' • poll closed' : p.closes_at ? ` • closes ${fmtDate(p.closes_at)}` : ''}</span>
        {!show && <Button size="sm" disabled={!pick.length} loading={vote.isPending} onClick={() => vote.mutate(pick)}>Vote</Button>}
      </div>
    </div>
  );
}

function Attachment({ post }: { post: PostT }) {
  if (post.event) return (
    <Link to={`/portal/events/${post.event.id}`} className="mt-3 flex overflow-hidden rounded-card border border-line hover:border-primary">
      {post.event.banner ? <img src={post.event.banner.url} alt="" className="h-24 w-32 shrink-0 object-cover" /> : <span className="grid h-24 w-32 shrink-0 place-items-center bg-primary-soft"><CalendarDays className="text-primary" /></span>}
      <span className="min-w-0 p-3"><span className="block text-xs font-medium uppercase text-primary">Event</span><span className="block truncate font-semibold text-ink">{post.event.title}</span>
        <span className="block text-sm text-ink-muted">{fmtDateTime(post.event.starts_at)} • {post.event.is_online ? 'Online' : post.event.venue}</span></span>
    </Link>
  );
  if (post.job) return (
    <Link to={`/portal/jobs/${post.job.id}`} className="mt-3 flex items-center gap-3 rounded-card border border-line p-3 hover:border-primary">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-btn bg-navy text-white"><Briefcase className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block text-xs font-medium uppercase text-primary">Job opportunity</span><span className="block truncate font-semibold text-ink">{post.job.title}</span>
        <span className="block text-sm text-ink-muted">{post.job.organization} • {post.job.location}</span></span>
    </Link>
  );
  return null;
}

export function PostCard({ post, compact, onChanged }: { post: PostT; compact?: boolean; onChanged?: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reactors, setReactors] = useState(false);
  const [saved, setSaved] = useState(post.saved);
  const [hidden, setHiddenLocal] = useState(false);
  const [local, setLocal] = useState<Pick<PostT, 'reactions' | 'reaction_count' | 'my_reaction'> | null>(null);
  useEffect(() => setSaved(post.saved), [post.saved]);
  const r = local ?? post;
  const react = useAction((kind: string | null) => api<{ data: { reactions: Record<string, number>; reaction_count: number; my_reaction: string | null } }>(
    `/api/v1/community/posts/${post.id}/reaction`, kind ? { method: 'PUT', body: { kind } } : { method: 'DELETE' }), { onSuccess: (x) => setLocal(x.data) });
  const save = useAction((on: boolean) => api(`/api/v1/community/posts/${post.id}/save`, { method: on ? 'PUT' : 'DELETE' }),
    { onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved'] }); } });
  const hide = useAction(() => api(`/api/v1/community/posts/${post.id}/hide`, { method: 'PUT' }), { onSuccess: () => setHiddenLocal(true) });
  const unhide = useAction(() => api(`/api/v1/community/posts/${post.id}/hide`, { method: 'DELETE' }), { onSuccess: () => setHiddenLocal(false) });
  const del = useAction(() => api(`/api/v1/community/posts/${post.id}`, { method: 'DELETE' }), { success: 'Post deleted.', invalidate: INVALIDATE, onSuccess: onChanged });
  const top = REACTIONS.filter((x) => r.reactions[x.key]).sort((a, b) => (r.reactions[b.key] ?? 0) - (r.reactions[a.key] ?? 0)).slice(0, 3);
  const mine = REACTIONS.find((x) => x.key === r.my_reaction);
  const modHidden = post.status === 'hidden';
  const toggleSave = () => { setSaved(!saved); save.mutate(!saved); };
  if (hidden) return (
    <Card className="flex items-center justify-between gap-3 p-4 text-sm text-ink-muted">
      <span>Post hidden. You won't see it in your feed.</span><Button size="sm" variant="ghost" onClick={() => unhide.mutate(undefined)}>Undo</Button>
    </Card>
  );
  return (
    <Card className={cn('p-4 sm:p-5', post.kind === 'announcement' && 'border-primary/40 bg-primary-soft/30', modHidden && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <AuthorLine post={post} />
        <div className="flex shrink-0 items-center gap-1">
          {post.kind === 'announcement' && <Badge tone="primary"><Megaphone className="h-3 w-3" />Announcement</Badge>}
          {post.is_pinned && <Badge><Pin className="h-3 w-3" />Pinned</Badge>}
          {post.status === 'draft' && <Badge tone="warning">Draft</Badge>}
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Post options"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              {post.status === 'published' && <MenuItem onSelect={toggleSave}>{saved ? <BookmarkCheck /> : <Bookmark />}{saved ? 'Remove from saved' : 'Save post'}</MenuItem>}
              <MenuItem onSelect={() => { navigator.clipboard?.writeText(`${location.origin}/portal/community/posts/${post.id}`); toast.success('Link copied.'); }}><Link2 />Copy link</MenuItem>
              {post.can_edit && <MenuItem onSelect={() => setEditing(true)}><Pencil />Edit</MenuItem>}
              {!post.can_edit && <MenuItem onSelect={() => hide.mutate(undefined)}><EyeOff />Not interested</MenuItem>}
              {!post.can_edit && <MenuItem onSelect={() => setReporting(true)}><Flag />Report</MenuItem>}
              {post.can_delete && (<><MenuSeparator /><MenuItem danger onSelect={async () => { if (await confirm({ title: 'Delete this post?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}><Trash2 />Delete</MenuItem></>)}
            </MenuContent>
          </Menu>
        </div>
      </div>
      {post.group && !compact && <p className="mt-2 text-xs text-ink-muted">in <Link to={`/portal/community/groups/${post.group.id}`} className="font-medium text-primary hover:underline">{post.group.name}</Link></p>}
      {modHidden && <Alert tone="warning" className="mt-3" title="Hidden by a moderator">{post.moderation_reason ?? 'This post is only visible to you.'}</Alert>}
      {post.kind === 'achievement' && (
        <div className="mt-3 flex items-center gap-3 rounded-card bg-gradient-to-r from-primary-soft to-transparent p-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-white"><Trophy className="h-5 w-5" /></span>
          <p className="font-heading font-semibold text-ink">{post.title ?? 'Achievement'}</p>
        </div>
      )}
      {post.title && post.kind !== 'achievement' && <h3 className={cn('mt-3 font-heading font-semibold text-ink', post.kind === 'article' ? 'text-xl' : 'text-lg')}>
        <Link to={`/portal/community/posts/${post.id}`} className="hover:text-primary">{post.title}</Link></h3>}
      {post.body && <RichText text={post.kind === 'article' && compact ? `${post.body.slice(0, 280)}${post.body.length > 280 ? '…' : ''}` : post.body} mentions={post.mentions} className="mt-2.5" />}
      {post.topics.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{post.topics.map((t) => <span key={t} className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">#{t}</span>)}</div>}
      {post.poll && <PollView post={post} />}
      <Attachment post={post} />
      <Gallery media={post.media} />
      {post.kind === 'share' && (post.shared_post ? (
        <div className="mt-3 rounded-card border border-line p-3"><PostCard post={post.shared_post} compact /></div>
      ) : post.shared_unavailable && <p className="mt-3 rounded-card border border-dashed border-line p-3 text-sm text-ink-muted">The shared post is no longer available.</p>)}
      {!compact && post.status === 'published' && (
        <>
          <div className="mt-3 flex items-center justify-between text-[13px] text-ink-muted">
            <button type="button" onClick={() => r.reaction_count && setReactors(true)} className="flex items-center gap-1.5 hover:text-ink" disabled={!r.reaction_count}>
              {top.length > 0 && <span className="flex -space-x-1">{top.map((x) => <span key={x.key} aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-surface text-[13px] ring-2 ring-surface">{x.emoji}</span>)}</span>}
              {r.reaction_count > 0 && <span>{r.reaction_count}</span>}
            </button>
            <span className="flex gap-2">
              {post.comment_count > 0 && <button onClick={() => setShowComments(true)} className="hover:text-ink">{post.comment_count} comment{post.comment_count === 1 ? '' : 's'}</button>}
              {post.comment_count > 0 && post.share_count > 0 && <span>•</span>}
              {post.share_count > 0 && <span>{post.share_count} share{post.share_count === 1 ? '' : 's'}</span>}
            </span>
          </div>
          {!modHidden && (
            <div className="mt-2 grid grid-cols-4 gap-1 border-t border-line pt-1.5">
              <div className="group relative">
                <Button variant="ghost" size="sm" className={cn('w-full', mine && 'bg-primary-soft text-primary')} disabled={!can('portal.react')}
                  onClick={() => react.mutate(mine ? null : 'like')} aria-pressed={!!mine}>
                  {mine ? <span aria-hidden>{mine.emoji}</span> : <ThumbsUp />}{mine?.label ?? 'Like'}
                </Button>
                {can('portal.react') && (
                  <div className="invisible absolute bottom-full start-0 z-20 mb-1 flex gap-1 rounded-full border border-line bg-surface px-2 py-1.5 opacity-0 shadow-pop transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100" role="toolbar" aria-label="Reactions">
                    {REACTIONS.map((x) => (
                      <button key={x.key} title={x.label} aria-label={x.label} onClick={() => react.mutate(x.key)}
                        className={cn('flex w-12 flex-col items-center rounded-full text-2xl transition hover:-translate-y-1', r.my_reaction === x.key && 'bg-primary-soft')}>
                        {x.emoji}<span className="text-[10px] font-medium text-ink-muted">{x.label}</span></button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowComments((s) => !s)}><MessageCircle />Comment</Button>
              <Button variant="ghost" size="sm" disabled={!can('portal.post')} onClick={() => setSharing(true)}><Repeat2 />Share</Button>
              <Button variant="ghost" size="sm" onClick={toggleSave} aria-pressed={saved} className={cn(saved && 'text-primary')}>{saved ? <BookmarkCheck /> : <Bookmark />}{saved ? 'Saved' : 'Save'}</Button>
            </div>
          )}
          {showComments && <Comments post={post} />}
        </>
      )}
      {post.status === 'draft' && post.can_edit && <DraftActions post={post} />}
      {editing && <EditPost post={post} onClose={() => setEditing(false)} />}
      {sharing && <ShareDialog post={post.kind === 'share' && post.shared_post ? post.shared_post : post} onClose={() => setSharing(false)} />}
      {reporting && <ReportDialog type="post" id={post.id} onClose={() => setReporting(false)} />}
      {reactors && <ReactionsDialog post={post} onClose={() => setReactors(false)} />}
    </Card>
  );
}

function DraftActions({ post }: { post: PostT }) {
  const publish = useAction(() => api(`/api/v1/community/posts/${post.id}/publish`, { method: 'POST' }), { success: 'Published.', invalidate: INVALIDATE });
  return <div className="mt-3 flex justify-end border-t border-line pt-3"><Button size="sm" loading={publish.isPending} onClick={() => publish.mutate(undefined)}><Send />Publish now</Button></div>;
}

function ReactionsDialog({ post, onClose }: { post: PostT; onClose: () => void }) {
  const q = useQuery({ queryKey: ['reactors', post.id], queryFn: () => get<{ kind: string; user: Author | null }[]>(`/api/v1/community/posts/${post.id}/reactions`) });
  const [tab, setTab] = useState('all');
  const counts = useMemo(() => (q.data ?? []).reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {}), [q.data]);
  const list = (q.data ?? []).filter((x) => tab === 'all' || x.kind === tab);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Reactions (${q.data?.length ?? post.reaction_count})`}>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        <button role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')} className={cn('rounded-full border px-3 py-1 text-sm font-medium', tab === 'all' ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>All</button>
        {REACTIONS.filter((x) => counts[x.key]).map((x) => <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
          className={cn('rounded-full border px-3 py-1 text-sm', tab === x.key ? 'border-primary bg-primary-soft' : 'border-line')}>{x.emoji} {counts[x.key]}</button>)}
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : (
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
          {list.map((x, i) => <li key={i} className="flex items-center gap-3 py-2.5">
            <Avatar name={x.user?.full_name} src={photoUrl(x.user?.photo ?? null, 80)} size={40} />
            <span className="min-w-0 flex-1"><Link to={x.user ? `/portal/alumni/${x.user.id}` : '#'} className="block truncate font-medium text-ink hover:text-primary">{x.user?.full_name ?? 'Former member'}</Link>
              <span className="block text-xs text-ink-muted">{x.user?.batch}</span></span>
            <span className="text-xl" aria-label={x.kind}>{REACTIONS.find((r) => r.key === x.kind)?.emoji}</span>
          </li>)}
        </ul>
      )}
    </Dialog>
  );
}

function EditPost({ post, onClose }: { post: PostT; onClose: () => void }) {
  const [body, setBody] = useState(post.body);
  const [title, setTitle] = useState(post.title ?? '');
  const save = useAction(() => api(`/api/v1/community/posts/${post.id}`, { method: 'PATCH', body: { body, title: post.title ? title : null } }),
    { success: 'Post updated.', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Edit post" wide
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      {post.title && <Field label="Title" className="mb-3">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field>}
      <Textarea aria-label="Post" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} className="min-h-[160px]" />
    </Dialog>
  );
}

function ShareDialog({ post, onClose }: { post: PostT; onClose: () => void }) {
  const [body, setBody] = useState('');
  const share = useAction(() => api('/api/v1/community/posts', { method: 'POST', body: { body, shared_post_id: post.id, client_key: `share-${post.id}-${Date.now()}` } }),
    { success: 'Shared to the community feed.', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Share post" wide
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={share.isPending} onClick={() => share.mutate(undefined)}><Repeat2 />Share</Button></>}>
      <Textarea aria-label="Add a comment" placeholder="Say something about this (optional)…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      <div className="mt-3 rounded-card border border-line p-3"><PostCard post={post} compact /></div>
    </Dialog>
  );
}

export function ReportDialog({ type, id, onClose }: { type: 'post' | 'comment'; id: string; onClose: () => void }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const send = useAction(() => api('/api/v1/community/reports', { method: 'POST', body: { target_type: type, target_id: id, reason, details: details || null } }),
    { success: 'Thank you. The moderators will review it.', onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Report ${type}`} description="Reports are confidential."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={send.isPending} onClick={() => send.mutate(undefined)}><Flag />Report</Button></>}>
      <div className="space-y-4">
        <Field label="Reason">{(fid) => <Select id={fid} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="spam">Spam or advertising</option><option value="harassment">Harassment or bullying</option><option value="hate">Hate speech</option>
          <option value="misinformation">False information</option><option value="inappropriate">Inappropriate content</option><option value="other">Something else</option></Select>}</Field>
        <Field label="Details (optional)">{(fid) => <Textarea id={fid} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />}</Field>
      </div>
    </Dialog>
  );
}

// ── people picker / @mentions ───────────────────────────────────────────────
type Person = { id: string; full_name: string; photo: Photo; batch?: string | null };
function usePeopleSearch(q: string) {
  const dq = useDebounced(q, 250);
  return useQuery({ queryKey: ['people-search', dq], enabled: dq.trim().length >= 2, staleTime: 30_000,
    queryFn: () => get<{ alumni: Person[] }>(`/api/v1/search?q=${encodeURIComponent(dq.trim())}&limit=6`).then((d) => d.alumni) });
}

/** Textarea with @mention suggestions; reports the mentioned people. */
function MentionTextarea({ value, onChange, mentions, onMentions, className, placeholder, label, onSubmit, rows }: {
  value: string; onChange: (v: string) => void; mentions: Person[]; onMentions: (p: Person[]) => void; className?: string; placeholder: string;
  label: string; onSubmit?: () => void; rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const people = usePeopleSearch(query ?? '');
  const detect = (v: string, pos: number) => {
    const m = /@([\p{L}][\p{L} .'-]{1,30})$/u.exec(v.slice(0, pos));
    setQuery(m ? m[1]! : null);
  };
  const pick = (p: Person) => {
    const el = ref.current!;
    const pos = el.selectionStart;
    const before = value.slice(0, pos).replace(/@([\p{L}][\p{L} .'-]{1,30})$/u, `@${p.full_name} `);
    onChange(before + value.slice(pos));
    if (!mentions.some((m) => m.id === p.id)) onMentions([...mentions, p]);
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length; });
  };
  return (
    <div className="relative">
      <Textarea ref={ref} aria-label={label} placeholder={placeholder} value={value} rows={rows} className={className}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); onMentions(mentions.filter((m) => e.target.value.includes(`@${m.full_name}`))); }}
        onKeyDown={(e) => { if (onSubmit && e.key === 'Enter' && !e.shiftKey && query === null) { e.preventDefault(); onSubmit(); } }} />
      {query !== null && (people.data?.length ?? 0) > 0 && (
        <ul className="absolute start-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-card border border-line bg-surface shadow-pop" role="listbox">
          {people.data!.map((p) => <li key={p.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-canvas">
            <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={28} />{p.full_name}<span className="ms-auto text-xs text-ink-muted">{p.batch}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

// ── comments ────────────────────────────────────────────────────────────────
export function Comments({ post }: { post: PostT }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [order, setOrder] = useState<'relevant' | 'newest'>('relevant');
  const [limit, setLimit] = useState(3);
  const q = useQuery({ queryKey: ['comments', post.id], queryFn: () => api<{ data: CommentT[]; meta: { next_cursor: string | null } }>(`/api/v1/community/posts/${post.id}/comments?limit=100`) });
  const [replyTo, setReplyTo] = useState<CommentT | null>(null);
  useRoom(post.group ? `group:${post.group.id}` : 'feed:all', {
    'comment:new': (d: { post_id: string }) => { if (d.post_id === post.id) qc.invalidateQueries({ queryKey: ['comments', post.id] }); },
    'comment:updated': (d: { post_id: string }) => { if (d.post_id === post.id) qc.invalidateQueries({ queryKey: ['comments', post.id] }); },
  });
  const all = [...(q.data?.data ?? [])].sort((a, b) => order === 'newest' ? b.created_at.localeCompare(a.created_at)
    : (b.reaction_count + (b.replies?.length ?? 0)) - (a.reaction_count + (a.replies?.length ?? 0)) || a.created_at.localeCompare(b.created_at));
  const shown = all.slice(0, limit);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-heading text-[15px] font-semibold text-ink">Comments ({post.comment_count})</p>
        <label className="flex items-center gap-1 text-sm text-ink-muted"><span className="sr-only">Sort comments</span>
          <select value={order} onChange={(e) => setOrder(e.target.value as 'relevant' | 'newest')} className="cursor-pointer bg-transparent font-medium text-ink focus:outline-none">
            <option value="relevant">Most relevant</option><option value="newest">Newest</option></select></label>
      </div>
      <div className="space-y-3">
        {q.isLoading ? <Skeleton className="h-12" /> : shown.map((c) => (
          <div key={c.id}>
            <CommentRow c={c} onReply={() => setReplyTo(c)} post={post} />
            {c.replies && c.replies.length > 0 && (
              <div className="ms-6 mt-2 space-y-2 border-s-2 border-line ps-4">{c.replies.map((r) => <CommentRow key={r.id} c={r} onReply={() => setReplyTo(c)} post={post} />)}</div>
            )}
          </div>
        ))}
        {q.data && q.data.data.length === 0 && <p className="text-sm text-ink-muted">No comments yet — start the conversation.</p>}
        {all.length > limit && <button className="flex items-center gap-1 text-sm font-medium text-primary hover:underline" onClick={() => setLimit(limit + 10)}>View {Math.min(10, all.length - limit)} more comment{all.length - limit === 1 ? '' : 's'}<ChevronDown className="h-4 w-4" /></button>}
      </div>
      {can('portal.post') && post.status === 'published' && <div className="mt-3"><CommentBox post={post} replyTo={replyTo} onDone={() => setReplyTo(null)} /></div>}
    </div>
  );
}

function CommentRow({ c, onReply, post }: { c: CommentT; onReply: () => void; post: PostT }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const [reporting, setReporting] = useState(false);
  const [state, setState] = useState<Pick<CommentT, 'reactions' | 'reaction_count' | 'my_reaction'>>(c);
  useEffect(() => setState(c), [c]);
  const inv = [['comments', post.id], ['feed'], ['post']];
  const save = useAction(() => api(`/api/v1/community/comments/${c.id}`, { method: 'PATCH', body: { body } }), { invalidate: inv, onSuccess: () => setEditing(false) });
  const del = useAction(() => api(`/api/v1/community/comments/${c.id}`, { method: 'DELETE' }), { success: 'Comment deleted.', invalidate: inv });
  const react = useAction((kind: string | null) => api<{ data: CommentT }>(`/api/v1/community/comments/${c.id}/reaction`, kind ? { method: 'PUT', body: { kind } } : { method: 'DELETE' }),
    { onSuccess: (r) => setState(r.data) });
  if (c.status === 'deleted') return <p className="text-sm italic text-ink-muted">Comment deleted.</p>;
  const isAuthor = c.author && post.author && c.author.id === post.author.id;
  const top = REACTIONS.filter((x) => state.reactions[x.key]).slice(0, 2);
  return (
    <div className="flex gap-2.5">
      <Avatar name={c.author?.full_name} src={photoUrl(c.author?.photo ?? null, 64)} size={36} />
      <div className="min-w-0 flex-1">
        <div className="relative rounded-2xl bg-canvas px-3.5 py-2.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px]"><span className="font-semibold text-ink">{c.author?.full_name ?? 'Former member'}</span>
            {c.author?.verified && <VerifiedBadge />}{isAuthor && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">Author</span>}
            {c.author?.batch && <span className="text-ink-muted">{c.author.batch}</span>}</p>
          {c.status === 'hidden' ? <p className="text-sm italic text-ink-muted">Hidden by a moderator.</p> : editing ? (
            <div className="mt-1 space-y-2">
              <Textarea aria-label="Edit comment" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[60px]" maxLength={2000} />
              <div className="flex gap-2"><Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
            </div>
          ) : <RichText text={c.body} mentions={c.mentions} className="mt-0.5 text-sm" />}
          {state.reaction_count > 0 && <span className="absolute -bottom-2.5 end-3 flex items-center gap-0.5 rounded-full bg-surface px-1.5 py-0.5 text-xs text-ink-muted shadow-card">{top.map((x) => <span key={x.key}>{x.emoji}</span>)}{state.reaction_count}</span>}
        </div>
        <div className="mt-1 flex gap-3 px-2 text-xs text-ink-muted">
          <button className={cn('font-medium hover:text-ink', state.my_reaction && 'text-primary')} onClick={() => react.mutate(state.my_reaction ? null : 'like')}>Like</button>
          <button className="font-medium hover:text-ink" onClick={onReply}>Reply</button>
          <time title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}</time>{c.edited_at && <span>edited</span>}
          {c.can_edit && !editing && <button className="hover:text-ink" onClick={() => setEditing(true)}>Edit</button>}
          {c.can_delete && <button className="hover:text-danger" onClick={async () => { if (await confirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}>Delete</button>}
          {!c.can_edit && <button className="hover:text-ink" onClick={() => setReporting(true)}>Report</button>}
        </div>
        {reporting && <ReportDialog type="comment" id={c.id} onClose={() => setReporting(false)} />}
      </div>
    </div>
  );
}

const QUICK_EMOJI = ['😀', '😂', '😍', '👏', '🙌', '🎉', '💜', '👍', '🙏', '🔥'];

function CommentBox({ post, replyTo, onDone }: { post: PostT; replyTo: CommentT | null; onDone: () => void }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Person[]>([]);
  const [emoji, setEmoji] = useState(false);
  useEffect(() => { if (replyTo?.author && !body) { setBody(`@${replyTo.author.full_name} `); setMentions([replyTo.author]); } }, [replyTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useAction(() => api(`/api/v1/community/posts/${post.id}/comments`, { method: 'POST', body: { body, parent_id: replyTo?.id ?? null, mention_ids: mentions.map((m) => m.id) } }),
    { invalidate: [['comments', post.id], ['feed'], ['post']], onSuccess: () => { setBody(''); setMentions([]); onDone(); } });
  const submit = () => { if (body.trim() && !send.isPending) send.mutate(undefined); };
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={user?.full_name} size={36} />
      <div className="min-w-0 flex-1">
        {replyTo && <p className="mb-1 flex items-center gap-1 text-xs text-ink-muted">Replying to {replyTo.author?.full_name}<button type="button" aria-label="Cancel reply" onClick={() => { onDone(); setBody(''); }}><X className="h-3 w-3" /></button></p>}
        <div className="relative flex items-end gap-1 rounded-2xl border border-line bg-surface pe-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <div className="min-w-0 flex-1"><MentionTextarea label="Write a comment" placeholder="Write a comment…" value={body} onChange={setBody} mentions={mentions} onMentions={setMentions}
            onSubmit={submit} rows={1} className="min-h-[44px] resize-none border-0 bg-transparent py-2.5 shadow-none focus:ring-0" /></div>
          <button type="button" aria-label="Emoji" onClick={() => setEmoji(!emoji)} className="mb-1.5 rounded-full p-1.5 text-ink-muted hover:bg-canvas hover:text-ink"><Smile className="h-5 w-5" /></button>
          <button type="button" aria-label="Send comment" disabled={!body.trim() || send.isPending} onClick={submit} className="mb-1.5 rounded-full p-1.5 text-primary hover:bg-primary-soft disabled:opacity-40">
            {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button>
          {emoji && <div className="absolute bottom-full end-0 z-20 mb-1 flex gap-1 rounded-card border border-line bg-surface p-1.5 shadow-pop">
            {QUICK_EMOJI.map((e) => <button key={e} type="button" className="rounded p-1 text-lg hover:bg-canvas" onClick={() => { setBody(body + e); setEmoji(false); }}>{e}</button>)}</div>}
        </div>
      </div>
    </div>
  );
}

// ── composer: entry card + "Create New Post" modal ──────────────────────────
type Kind = 'post' | 'achievement' | 'event' | 'job' | 'poll' | 'article';
const KINDS: { key: Kind; label: string; icon: typeof Pencil }[] = [
  { key: 'post', label: 'Post', icon: Pencil }, { key: 'achievement', label: 'Achievement', icon: Trophy }, { key: 'event', label: 'Event', icon: CalendarDays },
  { key: 'job', label: 'Job', icon: Briefcase }, { key: 'poll', label: 'Poll', icon: BarChart3 }, { key: 'article', label: 'Article', icon: FileText },
];

export function Composer({ groups, groupId, forum, announcementAllowed, placeholder }: { groups?: GroupT[]; groupId?: string; forum?: boolean; announcementAllowed?: boolean; placeholder?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState<{ kind: Kind; pickMedia?: 'image' | 'video' } | null>(null);
  const tools: { label: string; icon: typeof Pencil; kind: Kind; media?: 'image' | 'video' }[] = [
    { label: 'Photo', icon: ImagePlus, kind: 'post', media: 'image' }, { label: 'Video', icon: Video, kind: 'post', media: 'video' },
    { label: 'Poll', icon: BarChart3, kind: 'poll' }, { label: 'Event', icon: CalendarDays, kind: 'event' }, { label: 'Job', icon: Briefcase, kind: 'job' },
  ];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar name={user?.full_name} size={46} />
        <button type="button" onClick={() => setOpen({ kind: 'post' })} className="h-12 min-w-0 flex-1 truncate rounded-btn border border-line bg-surface px-4 text-start text-sm text-ink-muted hover:border-primary/50">
          {placeholder ?? (forum ? 'Start a discussion…' : 'Share an update, achievement, opportunity or memory…')}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3 sm:ps-[58px]">
        {tools.map((t) => <button key={t.label} type="button" onClick={() => setOpen({ kind: t.kind, pickMedia: t.media })}
          className="flex items-center gap-2 rounded-btn px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><t.icon className="h-[18px] w-[18px] text-primary" />{t.label}</button>)}
        <Button className="ms-auto" onClick={() => setOpen({ kind: 'post' })}>Post</Button>
      </div>
      {open && <CreatePostModal initialKind={open.kind} pickMedia={open.pickMedia} groups={groups} groupId={groupId} forum={forum}
        announcementAllowed={announcementAllowed} onClose={() => setOpen(null)} />}
    </Card>
  );
}

type Upload = { id: string; url: string; video: boolean };

export function CreatePostModal({ initialKind = 'post', pickMedia, groups, groupId, forum, announcementAllowed, onClose }: {
  initialKind?: Kind; pickMedia?: 'image' | 'video'; groups?: GroupT[]; groupId?: string; forum?: boolean; announcementAllowed?: boolean; onClose: () => void;
}) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [share, setShare] = useState(groupId ? `g:${groupId}` : 'community');
  const [announcement, setAnnouncement] = useState(false);
  const [files, setFiles] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [tagged, setTagged] = useState<Person[]>([]);
  const [location, setLocation] = useState('');
  const [feeling, setFeeling] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [panel, setPanel] = useState<'tag' | 'location' | 'feeling' | null>(null);
  const [poll, setPoll] = useState({ question: '', options: ['', ''], multiple: false, days: '7' });
  const [eventId, setEventId] = useState('');
  const [jobId, setJobId] = useState('');
  const key = useRef(crypto.randomUUID?.() ?? String(Date.now()));
  const fileRef = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState('image/*,video/mp4,video/webm,video/quicktime');
  useEffect(() => { if (pickMedia) { setAccept(pickMedia === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/*'); setTimeout(() => fileRef.current?.click(), 50); } }, [pickMedia]);
  const events = useQuery({ queryKey: ['compose-events'], enabled: kind === 'event', queryFn: () => api<{ data: { id: string; title: string; starts_at: string; is_past?: boolean }[] }>('/api/v1/events?page_size=50').then((r) => r.data) });
  const jobs = useQuery({ queryKey: ['compose-jobs'], enabled: kind === 'job', queryFn: () => api<{ data: { id: string; title: string; organization: string }[] }>('/api/v1/jobs?page_size=50').then((r) => r.data) });
  const myGroups = (groups ?? []).filter((g) => g.membership?.status === 'active' && g.status === 'active');
  const target = share.startsWith('g:') ? share.slice(2) : null;
  const isForum = forum || (target && groups?.find((g) => g.id === target)?.kind === 'forum');
  const payload = (draft: boolean) => ({
    kind, body, title: kind === 'article' || kind === 'achievement' || isForum ? title : null, group_id: target, audience: share === 'connections' ? 'connections' : 'community',
    media_ids: files.map((f) => f.id), announcement, client_key: `${key.current}${draft ? '-d' : ''}`, draft,
    tagged_ids: tagged.map((t) => t.id), mention_ids: mentions.map((m) => m.id), location: location || null, feeling: feeling || null, topics,
    poll: kind === 'poll' ? { question: poll.question, options: poll.options.filter((o) => o.trim()), multiple: poll.multiple,
      closes_at: poll.days ? new Date(Date.now() + Number(poll.days) * 86400000).toISOString() : null } : null,
    event_id: kind === 'event' ? eventId || null : null, job_id: kind === 'job' ? jobId || null : null,
  });
  const post = useAction((draft: boolean) => api('/api/v1/community/posts', { method: 'POST', body: payload(draft) }),
    { success: (r) => ((r as { data: PostT }).data.status === 'draft' ? 'Saved as a draft.' : 'Posted.'), invalidate: [['feed'], ['groups'], ['drafts']], onSuccess: onClose });
  const upload = async (list: FileList | null) => {
    setError(null);
    for (const f of Array.from(list ?? []).slice(0, 10 - files.length)) {
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await api<{ data: { id: string; url: string; variants: { width: number; url: string }[] } }>('/api/v1/community/uploads', { method: 'POST', body: fd });
        setFiles((x) => [...x, { id: r.data.id, url: r.data.variants.find((v) => v.width >= 480)?.url ?? r.data.url, video: f.type.startsWith('video/') }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally { setUploading((n) => n - 1); }
    }
  };
  const addTopic = () => { const t = topic.trim().replace(/^#/, ''); if (t && !topics.includes(t) && topics.length < 8) setTopics([...topics, t.slice(0, 40)]); setTopic(''); };
  const ready = uploading === 0 && !post.isPending && (
    kind === 'poll' ? poll.question.trim().length >= 3 && poll.options.filter((o) => o.trim()).length >= 2
      : kind === 'article' ? title.trim().length > 0 && body.trim().length >= 50
        : kind === 'event' ? !!eventId : kind === 'job' ? !!jobId
          : kind === 'achievement' ? title.trim().length > 0 : (body.trim().length > 0 || files.length > 0) && (!isForum || title.trim().length > 0));
  const err = post.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Create New Post"
      footer={<div className="flex w-full flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-line px-3">
          <Hash className="h-4 w-4 shrink-0 text-ink-muted" />
          {topics.map((t) => <span key={t} className="flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}><X className="h-3 w-3" /></button></span>)}
          <input aria-label="Add topics" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTopic(); } }} onBlur={addTopic}
            placeholder={topics.length ? '' : 'Add Topics (e.g. Reunion, Campus, Alumni Meet)'} className="h-10 min-w-[80px] flex-1 bg-transparent text-sm outline-none" />
        </div>
        {!groupId && kind !== 'event' && kind !== 'job' && <button type="button" className="text-sm font-semibold text-primary hover:underline disabled:opacity-50" disabled={post.isPending || uploading > 0}
          onClick={() => post.mutate(true)}>Save as Draft</button>}
        <Button disabled={!ready} loading={post.isPending} onClick={() => post.mutate(false)}><Send />Post</Button>
      </div>}>
      <div className="-mx-5 -mt-4 mb-4 flex gap-1 overflow-x-auto border-b border-line px-4 py-3" role="tablist" aria-label="Post type">
        {KINDS.map((k) => <button key={k.key} role="tab" aria-selected={kind === k.key} type="button" onClick={() => setKind(k.key)}
          className={cn('flex shrink-0 items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium', kind === k.key ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-canvas')}><k.icon className="h-4 w-4" />{k.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Avatar name={user?.full_name} size={48} /><div><p className="font-semibold text-ink">{user?.full_name}</p></div></div>
        {!groupId && <label className="flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm"><Users className="h-4 w-4 text-primary" /><span className="text-ink-muted">Share with:</span>
          <select aria-label="Share with" value={share} onChange={(e) => setShare(e.target.value)} className="cursor-pointer bg-transparent font-semibold text-ink focus:outline-none">
            <option value="community">Alumni Community</option><option value="connections">My Connections</option>
            {myGroups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}</select></label>}
      </div>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      <div className="mt-4 space-y-3">
        {(kind === 'article' || kind === 'achievement' || isForum) && (
          <Input aria-label="Title" placeholder={kind === 'achievement' ? 'What did you achieve? (e.g. Promoted to Project Director)' : kind === 'article' ? 'Article title' : 'Topic title'}
            value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="text-base font-medium" />
        )}
        {kind === 'poll' && (
          <div className="space-y-2 rounded-card border border-line p-3">
            <Input aria-label="Poll question" placeholder="Ask a question…" value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} maxLength={300} />
            {poll.options.map((o, i) => <div key={i} className="flex gap-2"><Input aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} value={o} maxLength={150}
              onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              {poll.options.length > 2 && <Button size="icon" variant="ghost" aria-label="Remove option" onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}><X /></Button>}</div>)}
            <div className="flex flex-wrap items-center gap-4">
              {poll.options.length < 6 && <Button size="sm" variant="outline" onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })}><Plus />Add option</Button>}
              <Checkbox checked={poll.multiple} onCheckedChange={(v) => setPoll({ ...poll, multiple: v })} label="Allow several answers" />
              <label className="flex items-center gap-2 text-sm">Closes after<select value={poll.days} onChange={(e) => setPoll({ ...poll, days: e.target.value })} className="rounded-btn border border-line px-2 py-1">
                <option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="">Never</option></select></label>
            </div>
          </div>
        )}
        {kind === 'event' && (
          <div className="rounded-card border border-line p-3">
            <Field label="Event to share" error={err.event_id}>{(id) => <Select id={id} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Choose an upcoming event…</option>{(events.data ?? []).filter((e) => !e.is_past).map((e) => <option key={e.id} value={e.id}>{e.title} — {fmtDate(e.starts_at)}</option>)}</Select>}</Field>
            <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={() => { onClose(); nav('/portal/events'); }}>Browse all events →</button>
          </div>
        )}
        {kind === 'job' && (
          <div className="rounded-card border border-line p-3">
            <Field label="Job to share" error={err.job_id}>{(id) => <Select id={id} value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Choose a job…</option>{(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.title} — {j.organization}</option>)}</Select>}</Field>
            <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={() => { onClose(); nav('/portal/jobs/post'); }}>Post a new job →</button>
          </div>
        )}
        <MentionTextarea label="Post text" value={body} onChange={setBody} mentions={mentions} onMentions={setMentions}
          placeholder={kind === 'article' ? 'Write your article…' : kind === 'achievement' ? 'Tell the community about it…' : kind === 'poll' ? 'Add some context (optional)…' : 'What would you like to share? Use @ to mention someone.'}
          className={cn('rounded-card border-primary/60 text-[15px]', kind === 'article' ? 'min-h-[220px]' : 'min-h-[130px]')} />
        {(files.length > 0 || uploading > 0) && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {files.map((f, i) => (
              <div key={f.id} className={cn('relative overflow-hidden rounded-card bg-canvas', i === 0 && files.length > 2 && 'sm:col-span-2')}>
                {f.video ? <video src={f.url} className="h-32 w-full object-cover" muted /> : <img src={f.url} alt="" className="h-32 w-full object-cover" />}
                {f.video && <Video className="absolute start-2 top-2 h-5 w-5 text-white drop-shadow" />}
                <button type="button" aria-label="Remove" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} className="absolute end-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-navy-dark/70 text-white"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {uploading > 0 && <div className="grid h-32 place-items-center rounded-card bg-canvas"><Loader2 className="animate-spin text-primary" /></div>}
            {files.length < 10 && <button type="button" onClick={() => { setAccept('image/*,video/mp4,video/webm,video/quicktime'); setTimeout(() => fileRef.current?.click()); }}
              className="grid h-32 place-items-center rounded-card border-2 border-dashed border-line text-sm text-ink-muted hover:border-primary hover:text-primary"><span className="flex flex-col items-center gap-1"><ImagePlus />Add More Photos / Videos</span></button>}
          </div>
        )}
        <input ref={fileRef} type="file" accept={accept} multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        {(tagged.length > 0 || location || feeling) && <p className="text-sm text-ink-muted">{feeling && <>Feeling <strong className="text-ink">{feeling}</strong> </>}
          {tagged.length > 0 && <>with <strong className="text-ink">{tagged.map((t) => t.full_name).join(', ')}</strong> </>}{location && <>at <strong className="text-ink">{location}</strong></>}</p>}
        <div className="grid grid-cols-2 overflow-hidden rounded-card border border-line sm:grid-cols-4">
          {[{ k: 'media', label: 'Photo / Video', icon: ImagePlus }, { k: 'tag', label: 'Tag People', icon: UserPlus }, { k: 'location', label: 'Location', icon: MapPin }, { k: 'feeling', label: 'Feeling / Activity', icon: Smile }].map((t, i) => (
            <button key={t.k} type="button" onClick={() => (t.k === 'media' ? (setAccept('image/*,video/mp4,video/webm,video/quicktime'), setTimeout(() => fileRef.current?.click())) : setPanel(panel === t.k ? null : t.k as 'tag'))}
              className={cn('flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium text-ink hover:bg-canvas', i > 0 && 'sm:border-s border-line', panel === t.k && 'bg-primary-soft text-primary')}>
              <t.icon className="h-5 w-5 text-primary" />{t.label}</button>
          ))}
        </div>
        {panel === 'tag' && <TagPeople tagged={tagged} onChange={setTagged} />}
        {panel === 'location' && <Input aria-label="Location" placeholder="Where are you? e.g. SST Campus, Rashidabad" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={150} />}
        {panel === 'feeling' && <div className="flex flex-wrap gap-2">{FEELINGS.map((f) => <button key={f} type="button" onClick={() => setFeeling(feeling === f ? '' : f)}
          className={cn('rounded-full border px-3 py-1 text-sm capitalize', feeling === f ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-canvas')}>{f}</button>)}</div>}
        {announcementAllowed && !target && (
          <Checkbox checked={announcement} onCheckedChange={setAnnouncement} label="Publish as an announcement (pinned style, everyone)" />
        )}
      </div>
    </Dialog>
  );
}

function TagPeople({ tagged, onChange }: { tagged: Person[]; onChange: (p: Person[]) => void }) {
  const [q, setQ] = useState('');
  const people = usePeopleSearch(q);
  return (
    <div className="rounded-card border border-line p-3">
      <div className="flex flex-wrap gap-1.5">{tagged.map((t) => <span key={t.id} className="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-sm text-primary">{t.full_name}
        <button type="button" aria-label={`Remove ${t.full_name}`} onClick={() => onChange(tagged.filter((x) => x.id !== t.id))}><X className="h-3 w-3" /></button></span>)}</div>
      <Input aria-label="Search people to tag" className="mt-2" placeholder="Search alumni to tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      {(people.data?.length ?? 0) > 0 && <ul className="mt-2 divide-y divide-line">{people.data!.filter((p) => !tagged.some((t) => t.id === p.id)).map((p) => (
        <li key={p.id}><button type="button" onClick={() => { onChange([...tagged, p]); setQ(''); }} className="flex w-full items-center gap-2 py-2 text-start text-sm hover:text-primary">
          <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={28} />{p.full_name}<span className="ms-auto text-xs text-ink-muted">{p.batch}</span></button></li>))}</ul>}
    </div>
  );
}

// ── feed ────────────────────────────────────────────────────────────────────
export function Feed({ filter = 'all', groupId, q, sort = 'latest', endpoint }: { filter?: string; groupId?: string; q?: string; sort?: string; endpoint?: string }) {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState(0);
  const params = new URLSearchParams({ filter, sort, ...(groupId ? { group_id: groupId } : {}), ...(q ? { q } : {}) });
  const url = endpoint ?? `/api/v1/community/feed?${params}`;
  const feed = useInfiniteQuery({
    queryKey: ['feed', url],
    queryFn: ({ pageParam }) => api<FeedPage>(`${url}${url.includes('?') ? '&' : '?'}${pageParam ? `cursor=${pageParam}` : ''}`),
    initialPageParam: '', getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
  });
  useRoom(endpoint ? null : groupId ? `group:${groupId}` : 'feed:all', {
    'post:new': () => setFresh((n) => n + 1),
    'post:updated': () => qc.invalidateQueries({ queryKey: ['feed'] }),
    'post:deleted': () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [feed]);
  const pinned = feed.data?.pages[0]?.meta.pinned ?? [];
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-4">
      {fresh > 0 && (
        <button onClick={() => { setFresh(0); feed.refetch(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="sticky top-[80px] z-10 mx-auto block rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white shadow-pop">
          {fresh} new post{fresh === 1 ? '' : 's'} — show
        </button>
      )}
      {feed.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-card" />) : (
        <>
          {pinned.map((p) => <PostCard key={`pin-${p.id}`} post={p} />)}
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
          {!pinned.length && !posts.length && <Card><EmptyState icon={Users} title="Nothing here yet" description={q ? 'No posts match your search.' : 'Be the first to post.'} /></Card>}
          <div ref={sentinel} />
          {feed.isFetchingNextPage && <p className="flex items-center justify-center gap-2 py-3 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin text-primary" />Loading more posts…</p>}
        </>
      )}
    </div>
  );
}

export function useGroups(scope: 'mine' | 'discover', q = '') {
  return useQuery({ queryKey: ['groups', scope, q], queryFn: () => get<GroupT[]>(`/api/v1/community/groups?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
}

export function SectionCard({ title, icon: Icon, action, children, className }: { title: ReactNode; icon?: typeof Users; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-heading text-[16px] font-semibold text-ink">{Icon && <Icon className="h-5 w-5 text-primary" />}{title}</h2>{action}</div>
      {children}
    </Card>
  );
}


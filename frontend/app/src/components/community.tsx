import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Flag, ImagePlus, Loader2, Megaphone, MessageCircle, MoreHorizontal, Pencil, Pin, Repeat2, Send, ThumbsUp,
  Trash2, Users, X } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { photoUrl, type Photo } from '@/lib/alumni';
import { useRoom } from '@/lib/live';
import { cn, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay';
import { VerifiedBadge } from '@/components/alumni';

export type Author = { id: string; full_name: string; photo: Photo; verified: boolean; headline: string | null; batch: string | null; staff: boolean };
export type PostT = {
  id: string; kind: 'post' | 'announcement' | 'share'; title: string | null; body: string; status: string; moderation_reason: string | null;
  author: Author | null; group: { id: string; name: string; kind: string } | null;
  media: { id: string; url: string; variants: { width: number; url: string }[]; width: number | null; height: number | null; alt: string }[];
  shared_post: PostT | null; shared_unavailable: boolean; is_pinned: boolean; comment_count: number; reaction_count: number; share_count: number;
  reactions: Record<string, number>; my_reaction: string | null; created_at: string; edited_at: string | null; can_edit: boolean; can_delete: boolean;
};
export type CommentT = { id: string; post_id: string; parent_id: string | null; body: string; status: string; author: Author | null;
  created_at: string; edited_at: string | null; can_edit: boolean; can_delete: boolean; replies?: CommentT[] };
export type GroupT = { id: string; name: string; description: string; kind: 'batch' | 'interest' | 'forum'; join_policy: 'open' | 'approval';
  status: string; member_count: number; post_count: number; last_post_at: string | null; cover: Photo; batch_id: string | null;
  membership: { role: string; status: string } | null; can_manage: boolean; readable?: boolean };
type FeedPage = { data: PostT[]; meta: { next_cursor: string | null; pinned: PostT[] } };

export const REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: 'like', emoji: '👍', label: 'Like' }, { key: 'love', emoji: '❤️', label: 'Love' }, { key: 'celebrate', emoji: '🎉', label: 'Celebrate' },
  { key: 'support', emoji: '🤝', label: 'Support' }, { key: 'insightful', emoji: '💡', label: 'Insightful' },
];

/** Plain text with clickable links (content is never rendered as HTML). */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <p className={cn('whitespace-pre-line break-words text-[15px] leading-relaxed text-ink', className)}>
      {parts.map((p, i) => (/^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline-offset-2 hover:underline">{p}</a>
        : <Fragment key={i}>{p}</Fragment>))}
    </p>
  );
}

function AuthorLine({ a, at, edited, extra }: { a: Author | null; at: string; edited?: string | null; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={a?.full_name} src={photoUrl(a?.photo ?? null, 80)} size={42} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          {a ? <Link to={`/portal/alumni/${a.id}`} className="font-semibold text-ink hover:text-primary">{a.full_name}</Link> : <span className="font-semibold text-ink-muted">Former member</span>}
          {a?.verified && <VerifiedBadge />}{a?.staff && <Badge tone="navy">Alumni office</Badge>}{extra}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {[a?.headline, a?.batch].filter(Boolean).join(' · ')}{(a?.headline || a?.batch) && ' · '}
          <time dateTime={at} title={fmtDateTime(at)}>{timeAgo(at)}</time>{edited && ' · edited'}
        </p>
      </div>
    </div>
  );
}

function Gallery({ media }: { media: PostT['media'] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const pick = (m: PostT['media'][number], w: number) => m.variants.find((v) => v.width >= w)?.url ?? m.url;
  return (
    <>
      <div className={cn('mt-3 grid gap-1 overflow-hidden rounded-card', media.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {media.slice(0, 4).map((m, i) => (
          <button key={m.id} onClick={() => setOpen(i)} className="relative block bg-canvas" aria-label="Open photo">
            <img src={pick(m, media.length === 1 ? 1200 : 480)} alt={m.alt} loading="lazy"
              className={cn('w-full object-cover', media.length === 1 ? 'max-h-[520px]' : 'aspect-square')} />
            {i === 3 && media.length > 4 && <span className="absolute inset-0 grid place-items-center bg-navy-dark/60 text-2xl font-semibold text-white">+{media.length - 4}</span>}
          </button>
        ))}
      </div>
      {open !== null && (
        <Dialog open onOpenChange={(v) => !v && setOpen(null)} title={`Photo ${open + 1} of ${media.length}`} wide
          footer={media.length > 1 && <><Button variant="outline" onClick={() => setOpen((open + media.length - 1) % media.length)}>Previous</Button>
            <Button variant="outline" onClick={() => setOpen((open + 1) % media.length)}>Next</Button></>}>
          <img src={pick(media[open]!, 1920)} alt={media[open]!.alt} className="mx-auto max-h-[70vh] w-auto" />
        </Dialog>
      )}
    </>
  );
}

const INVALIDATE = [['feed'], ['post'], ['admin-community']];

export function PostCard({ post, compact, onChanged }: { post: PostT; compact?: boolean; onChanged?: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [local, setLocal] = useState<Pick<PostT, 'reactions' | 'reaction_count' | 'my_reaction'> | null>(null);
  const r = local ?? post;
  const react = useAction((kind: string | null) => api<{ data: { reactions: Record<string, number>; reaction_count: number; my_reaction: string | null } }>(
    `/api/v1/community/posts/${post.id}/reaction`, kind ? { method: 'PUT', body: { kind } } : { method: 'DELETE' }),
  { onSuccess: (x) => setLocal(x.data) });
  const del = useAction(() => api(`/api/v1/community/posts/${post.id}`, { method: 'DELETE' }), { success: 'Post deleted.', invalidate: INVALIDATE, onSuccess: onChanged });
  const top = REACTIONS.filter((x) => r.reactions[x.key]).sort((a, b) => (r.reactions[b.key] ?? 0) - (r.reactions[a.key] ?? 0)).slice(0, 3);
  const mine = REACTIONS.find((x) => x.key === r.my_reaction);
  const hidden = post.status === 'hidden';
  return (
    <Card className={cn('p-4 sm:p-5', post.kind === 'announcement' && 'border-primary/40 bg-primary-soft/30', hidden && 'opacity-80')}>
      <div className="flex items-start justify-between gap-3">
        <AuthorLine a={post.author} at={post.created_at} edited={post.edited_at}
          extra={<>{post.kind === 'announcement' && <Badge tone="primary"><Megaphone className="h-3 w-3" />Announcement</Badge>}
            {post.is_pinned && <Badge><Pin className="h-3 w-3" />Pinned</Badge>}</>} />
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Post options"><MoreHorizontal /></Button></MenuTrigger>
          <MenuContent>
            {post.can_edit && <MenuItem onSelect={() => setEditing(true)}><Pencil />Edit</MenuItem>}
            {!post.can_edit && <MenuItem onSelect={() => setReporting(true)}><Flag />Report</MenuItem>}
            {post.can_delete && (<><MenuSeparator /><MenuItem danger onSelect={async () => { if (await confirm({ title: 'Delete this post?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}><Trash2 />Delete</MenuItem></>)}
          </MenuContent>
        </Menu>
      </div>
      {post.group && !compact && <p className="mt-2 text-xs text-ink-muted">in <Link to={`/portal/community/groups/${post.group.id}`} className="font-medium text-primary hover:underline">{post.group.name}</Link></p>}
      {hidden && <Alert tone="warning" className="mt-3" title="Hidden by a moderator">{post.moderation_reason ?? 'This post is only visible to you.'}</Alert>}
      {post.title && <h3 className="mt-3 font-heading text-lg font-semibold text-ink"><Link to={`/portal/community/posts/${post.id}`} className="hover:text-primary">{post.title}</Link></h3>}
      {post.body && <RichText text={post.body} className="mt-3" />}
      <Gallery media={post.media} />
      {post.kind === 'share' && (post.shared_post ? (
        <div className="mt-3 rounded-card border border-line p-3"><PostCard post={post.shared_post} compact /></div>
      ) : post.shared_unavailable && <p className="mt-3 rounded-card border border-dashed border-line p-3 text-sm text-ink-muted">The shared post is no longer available.</p>)}
      {!compact && (
        <>
          <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
            <span className="flex items-center gap-1">{top.map((x) => <span key={x.key} aria-hidden>{x.emoji}</span>)}{r.reaction_count > 0 && <span className="ml-1">{r.reaction_count}</span>}</span>
            <span className="flex gap-3">
              {post.comment_count > 0 && <button onClick={() => setShowComments(true)} className="hover:text-ink">{post.comment_count} comment{post.comment_count === 1 ? '' : 's'}</button>}
              {post.share_count > 0 && <span>{post.share_count} share{post.share_count === 1 ? '' : 's'}</span>}
            </span>
          </div>
          {!hidden && (
            <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-2">
              <div className="group relative">
                <Button variant="ghost" size="sm" className={cn('w-full', mine && 'text-primary')} disabled={!can('portal.react')}
                  onClick={() => react.mutate(mine ? null : 'like')} aria-pressed={!!mine}>
                  {mine ? <span aria-hidden>{mine.emoji}</span> : <ThumbsUp />}{mine?.label ?? 'Like'}
                </Button>
                {can('portal.react') && (
                  <div className="invisible absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-line bg-surface p-1 opacity-0 shadow-pop transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100" role="toolbar" aria-label="Reactions">
                    {REACTIONS.map((x) => (
                      <button key={x.key} title={x.label} aria-label={x.label} onClick={() => react.mutate(x.key)}
                        className={cn('grid h-9 w-9 place-items-center rounded-full text-xl transition hover:scale-125 hover:bg-canvas', r.my_reaction === x.key && 'bg-primary-soft')}>{x.emoji}</button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowComments((s) => !s)}><MessageCircle />Comment</Button>
              <Button variant="ghost" size="sm" disabled={!can('portal.post')} onClick={() => setSharing(true)}><Repeat2 />Share</Button>
            </div>
          )}
          {showComments && <Comments post={post} />}
        </>
      )}
      {editing && <EditPost post={post} onClose={() => setEditing(false)} />}
      {sharing && <ShareDialog post={post.kind === 'share' && post.shared_post ? post.shared_post : post} onClose={() => setSharing(false)} />}
      {reporting && <ReportDialog type="post" id={post.id} onClose={() => setReporting(false)} />}
    </Card>
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
      {post.title && <Field label="Title" className="mb-3">{(id) => <input id={id} className="h-10 w-full rounded-btn border border-line px-3 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field>}
      <Textarea aria-label="Post" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} className="min-h-[160px]" />
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

// ── comments ────────────────────────────────────────────────────────────────
export function Comments({ post }: { post: PostT }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comments', post.id], queryFn: () => api<{ data: CommentT[]; meta: { next_cursor: string | null } }>(`/api/v1/community/posts/${post.id}/comments`) });
  const [replyTo, setReplyTo] = useState<CommentT | null>(null);
  useRoom(post.group ? `group:${post.group.id}` : 'feed:all', {
    'comment:new': (d: { post_id: string }) => { if (d.post_id === post.id) qc.invalidateQueries({ queryKey: ['comments', post.id] }); },
  });
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {q.isLoading ? <Skeleton className="h-12" /> : q.data?.data.map((c) => (
        <div key={c.id}>
          <CommentRow c={c} onReply={() => setReplyTo(c)} post={post} />
          {c.replies && c.replies.length > 0 && (
            <div className="ml-11 mt-2 space-y-2 border-l-2 border-line pl-3">{c.replies.map((r) => <CommentRow key={r.id} c={r} onReply={() => setReplyTo(c)} post={post} />)}</div>
          )}
        </div>
      ))}
      {q.data && q.data.data.length === 0 && <p className="text-sm text-ink-muted">No comments yet.</p>}
      {can('portal.post') && post.status === 'published' && <CommentBox post={post} replyTo={replyTo} onDone={() => setReplyTo(null)} />}
    </div>
  );
}

function CommentRow({ c, onReply, post }: { c: CommentT; onReply: () => void; post: PostT }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const [reporting, setReporting] = useState(false);
  const inv = [['comments', post.id], ['feed'], ['post']];
  const save = useAction(() => api(`/api/v1/community/comments/${c.id}`, { method: 'PATCH', body: { body } }), { invalidate: inv, onSuccess: () => setEditing(false) });
  const del = useAction(() => api(`/api/v1/community/comments/${c.id}`, { method: 'DELETE' }), { success: 'Comment deleted.', invalidate: inv });
  if (c.status === 'deleted') return <p className="text-sm italic text-ink-muted">Comment deleted.</p>;
  return (
    <div className="flex gap-2.5">
      <Avatar name={c.author?.full_name} src={photoUrl(c.author?.photo ?? null, 64)} size={32} />
      <div className="min-w-0 flex-1">
        <div className="rounded-card bg-canvas px-3 py-2">
          <p className="flex items-center gap-1 text-[13px] font-semibold text-ink">{c.author?.full_name ?? 'Former member'}{c.author?.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary" />}</p>
          {c.status === 'hidden' ? <p className="text-sm italic text-ink-muted">Hidden by a moderator.</p> : editing ? (
            <div className="mt-1 space-y-2">
              <Textarea aria-label="Edit comment" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[60px]" maxLength={2000} />
              <div className="flex gap-2"><Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
            </div>
          ) : <RichText text={c.body} className="text-sm" />}
        </div>
        <div className="mt-1 flex gap-3 px-1 text-xs text-ink-muted">
          <time title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}</time>{c.edited_at && <span>edited</span>}
          <button className="font-medium hover:text-ink" onClick={onReply}>Reply</button>
          {c.can_edit && !editing && <button className="hover:text-ink" onClick={() => setEditing(true)}>Edit</button>}
          {c.can_delete && <button className="hover:text-danger" onClick={async () => { if (await confirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) del.mutate(undefined); }}>Delete</button>}
          {!c.can_edit && <button className="hover:text-ink" onClick={() => setReporting(true)}>Report</button>}
        </div>
        {reporting && <ReportDialog type="comment" id={c.id} onClose={() => setReporting(false)} />}
      </div>
    </div>
  );
}

function CommentBox({ post, replyTo, onDone }: { post: PostT; replyTo: CommentT | null; onDone: () => void }) {
  const [body, setBody] = useState('');
  const send = useAction(() => api(`/api/v1/community/posts/${post.id}/comments`, { method: 'POST', body: { body, parent_id: replyTo?.id ?? null } }),
    { invalidate: [['comments', post.id], ['feed'], ['post']], onSuccess: () => { setBody(''); onDone(); } });
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(undefined); }}>
      <div className="min-w-0 flex-1">
        {replyTo && <p className="mb-1 flex items-center gap-1 text-xs text-ink-muted">Replying to {replyTo.author?.full_name}<button type="button" aria-label="Cancel reply" onClick={onDone}><X className="h-3 w-3" /></button></p>}
        <Textarea aria-label="Write a comment" placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000}
          className="min-h-[42px] resize-none py-2" rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && body.trim()) { e.preventDefault(); send.mutate(undefined); } }} />
      </div>
      <Button type="submit" size="icon" aria-label="Send comment" loading={send.isPending} disabled={!body.trim()}><Send /></Button>
    </form>
  );
}

// ── composer ────────────────────────────────────────────────────────────────
export function Composer({ groups, groupId, forum, announcementAllowed }: { groups?: GroupT[]; groupId?: string; forum?: boolean; announcementAllowed?: boolean }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState(groupId ?? '');
  const [announcement, setAnnouncement] = useState(false);
  const [files, setFiles] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID?.() ?? String(Date.now()));
  const fileRef = useRef<HTMLInputElement>(null);
  const isForum = forum || groups?.find((g) => g.id === target)?.kind === 'forum';
  const post = useAction(() => api('/api/v1/community/posts', { method: 'POST', body: {
    body, title: isForum ? title : null, group_id: target || null, media_ids: files.map((f) => f.id), announcement, client_key: key.current,
  } }), { success: 'Posted.', invalidate: [['feed'], ['groups']], onSuccess: () => {
    setBody(''); setTitle(''); setFiles([]); setAnnouncement(false); key.current = crypto.randomUUID?.() ?? String(Date.now());
  } });
  const upload = async (list: FileList | null) => {
    setError(null);
    for (const f of Array.from(list ?? []).slice(0, 6 - files.length)) {
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await api<{ data: { id: string; url: string; variants: { width: number; url: string }[] } }>('/api/v1/community/uploads', { method: 'POST', body: fd });
        setFiles((x) => [...x, { id: r.data.id, url: r.data.variants[0]?.url ?? r.data.url }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally { setUploading((n) => n - 1); }
    }
  };
  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Avatar name={user?.full_name} size={42} />
        <div className="min-w-0 flex-1 space-y-2">
          {isForum && <input aria-label="Topic title" placeholder="Topic title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
            className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-sm font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />}
          <Textarea aria-label="Write a post" placeholder={isForum ? 'Start the discussion…' : 'Share news, ask a question or post an update…'} value={body}
            onChange={(e) => setBody(e.target.value)} maxLength={5000} className="min-h-[80px] resize-y" />
          {error && <p className="text-xs text-danger">{error}</p>}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <span key={f.id} className="relative">
                  <img src={f.url} alt="" className="h-20 w-20 rounded-btn object-cover" />
                  <button type="button" aria-label="Remove photo" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-navy text-white"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={files.length >= 6 || uploading > 0}>
              {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}Photo
            </Button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            {groups && !groupId && (
              <Select aria-label="Post to" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-auto max-w-[220px] text-[13px]">
                <option value="">Everyone</option>{groups.filter((g) => g.membership?.status === 'active' && g.status === 'active').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            )}
            {announcementAllowed && !target && (
              <label className="flex items-center gap-1.5 text-[13px] text-ink"><input type="checkbox" checked={announcement} onChange={(e) => setAnnouncement(e.target.checked)} />Announcement</label>
            )}
            <Button size="sm" className="ml-auto" loading={post.isPending} disabled={uploading > 0 || (!body.trim() && !files.length) || (isForum && !title.trim())}
              onClick={() => post.mutate(undefined)}><Send />Post</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── feed ────────────────────────────────────────────────────────────────────
export function Feed({ filter = 'all', groupId, q }: { filter?: string; groupId?: string; q?: string }) {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState(0);
  const params = new URLSearchParams({ filter, ...(groupId ? { group_id: groupId } : {}), ...(q ? { q } : {}) });
  const feed = useInfiniteQuery({
    queryKey: ['feed', filter, groupId ?? '', q ?? ''],
    queryFn: ({ pageParam }) => api<FeedPage>(`/api/v1/community/feed?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '', getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
  });
  useRoom(groupId ? `group:${groupId}` : 'feed:all', {
    'post:new': () => setFresh((n) => n + 1),
    'post:updated': () => qc.invalidateQueries({ queryKey: ['feed'] }),
    'post:deleted': () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
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
      {feed.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-card" />) : (
        <>
          {pinned.map((p) => <PostCard key={`pin-${p.id}`} post={p} />)}
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
          {!pinned.length && !posts.length && <Card><EmptyState icon={Users} title="Nothing here yet" description={q ? 'No posts match your search.' : 'Be the first to post.'} /></Card>}
          {feed.hasNextPage && <div className="text-center"><Button variant="outline" loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>Load more</Button></div>}
        </>
      )}
    </div>
  );
}

export function useGroups(scope: 'mine' | 'discover', q = '') {
  return useQuery({ queryKey: ['groups', scope, q], queryFn: () => get<GroupT[]>(`/api/v1/community/groups?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
}

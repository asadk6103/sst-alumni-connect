import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, BellOff, Check, CheckCheck, CornerUpLeft, Download, FileText, Loader2, MessageSquarePlus, MoreHorizontal,
  Paperclip, Pencil, Pin, Search, Send, Smile, Trash2, UserMinus, Users, X } from 'lucide-react';
import { api, get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl, type PersonCard } from '@/lib/alumni';
import { useLive, useRoom } from '@/lib/live';
import { cn, fmtBytes, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import type { Author } from '@/components/community';

type Conv = {
  id: string; kind: 'direct' | 'group'; title: string; custom_title: string | null; members: (Author & { role: string; online: boolean })[];
  is_admin: boolean; blocked: boolean; last_message_at: string | null; last_message_preview: string | null; last_sender: Author | null;
  unread: number; muted: boolean; archived: boolean; pinned: boolean;
};
type Att = { id: string; filename: string; mime: string; size: number; width: number | null; height: number | null; url: string };
type Msg = {
  id: string; conversation_id: string; sender_id: string | null; kind: 'text' | 'system'; body: string; deleted: boolean; client_id: string | null;
  reply_to: { id: string; sender_id: string | null; body: string; deleted: boolean } | null; attachments: Att[];
  reactions: { emoji: string; count: number; mine: boolean }[]; created_at: string; edited_at: string | null; status: 'sent' | 'delivered' | 'read' | null;
  pending?: boolean; failed?: boolean;
};
type Page = { data: Msg[]; meta: { before: string | null; people: Record<string, Author> } };
const QUICK = ['👍', '❤️', '😂', '🎉', '🙏'];

export function MessagesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [starting, setStarting] = useState<'direct' | 'group' | null>(null);
  const dq = useDebounced(q);
  const { connected } = useLive();
  // Live updates come over the WebSocket; without it, poll so chat keeps working.
  const list = useQuery({ queryKey: ['conversations', dq, archived], refetchInterval: connected ? false : 10_000,
    queryFn: () => get<Conv[]>(`/api/v1/messages/conversations${qs({ q: dq, archived: archived || undefined })}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['conversations'] });
  useRoom(null, {
    'message:new': refresh, 'conversation:new': refresh, 'conversation:updated': refresh, 'conversation:read': refresh,
    presence: refresh,
  });
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-my-8">
      <div className="grid h-[calc(100vh-68px)] grid-cols-1 bg-surface md:grid-cols-[340px_1fr] md:border-x md:border-line">
        <aside className={cn('flex min-h-0 flex-col border-r border-line', id && 'hidden md:flex')}>
          <div className="space-y-3 border-b border-line p-4">
            <div className="flex items-center justify-between">
              <h1 className="font-heading text-lg font-semibold text-ink">Messages</h1>
              <Menu>
                <MenuTrigger asChild><Button size="icon" variant="ghost" aria-label="New conversation"><MessageSquarePlus /></Button></MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => setStarting('direct')}><MessageSquarePlus />New message</MenuItem>
                  <MenuItem onSelect={() => setStarting('group')}><Users />New group chat</MenuItem>
                </MenuContent>
              </Menu>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input aria-label="Search conversations" placeholder="Search people or groups…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" />
            </div>
            <div className="flex gap-1 text-xs">
              {[false, true].map((a) => (
                <button key={String(a)} onClick={() => setArchived(a)} className={cn('rounded-full px-3 py-1', archived === a ? 'bg-primary-soft font-medium text-primary' : 'text-ink-muted hover:bg-canvas')}>
                  {a ? 'Archived' : 'Inbox'}
                </button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-4"><Skeleton className="h-10" /></li>)
              : !list.data?.length ? <li><EmptyState icon={MessageSquarePlus} title={q ? 'No matches' : 'No conversations yet'} description="Message your connections and batchmates."
                  action={<Button size="sm" onClick={() => setStarting('direct')}>New message</Button>} /></li>
              : list.data.map((c) => <ConvRow key={c.id} c={c} active={c.id === id} />)}
          </ul>
        </aside>
        <section className={cn('min-h-0 min-w-0', !id && 'hidden md:block')}>
          {id ? <Thread key={id} id={id} onBack={() => nav('/portal/messages')} />
            : <div className="grid h-full place-items-center"><EmptyState icon={MessageSquarePlus} title="Select a conversation" description="Or start a new one with a connection or batchmate." /></div>}
        </section>
      </div>
      {starting && <NewConversation kind={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

function ConvAvatar({ c, size = 44 }: { c: Conv; size?: number }) {
  const { user } = useAuth();
  const other = c.members.find((m) => m.id !== user?.id);
  if (c.kind === 'group') return <span className="grid shrink-0 place-items-center rounded-full bg-primary-soft text-primary" style={{ width: size, height: size }}><Users className="h-1/2 w-1/2" /></span>;
  return (
    <span className="relative shrink-0">
      <Avatar name={c.title} src={photoUrl(other?.photo ?? null, size * 2)} size={size} />
      {other?.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-success" aria-label="Online" />}
    </span>
  );
}

function ConvRow({ c, active }: { c: Conv; active: boolean }) {
  const { user } = useAuth();
  const mine = c.last_sender?.id === user?.id;
  return (
    <li>
      <Link to={`/portal/messages/${c.id}`} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-canvas', active && 'bg-primary-soft/60')}>
        <ConvAvatar c={c} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className={cn('truncate text-sm text-ink', c.unread ? 'font-semibold' : 'font-medium')}>{c.title}</span>
            {c.pinned && <Pin className="h-3 w-3 shrink-0 text-ink-muted" />}{c.muted && <BellOff className="h-3 w-3 shrink-0 text-ink-muted" />}
            <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
          </p>
          <p className="flex items-center gap-2">
            <span className={cn('truncate text-xs', c.unread ? 'font-medium text-ink' : 'text-ink-muted')}>{mine && 'You: '}{c.last_message_preview ?? 'No messages yet'}</span>
            {c.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-[18px] text-white">{c.unread}</span>}
          </p>
        </div>
      </Link>
    </li>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth();
  const { socket, connected } = useLive();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => get<Conv>(`/api/v1/messages/conversations/${id}`) });
  const pages = useInfiniteQuery({
    refetchInterval: connected ? false : 10_000,
    queryKey: ['messages', id], initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page>(`/api/v1/messages/conversations/${id}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta.before ?? undefined,
  });
  const [pending, setPending] = useState<Msg[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const people = useMemo(() => {
    const out: Record<string, Author> = {};
    for (const p of pages.data?.pages ?? []) Object.assign(out, p.meta.people);
    for (const m of conv.data?.members ?? []) out[m.id] = m;
    return out;
  }, [pages.data, conv.data]);
  const messages = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(pages.data?.pages ?? [])].reverse().flatMap((p) => p.data).filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    const clientIds = new Set(all.map((m) => m.client_id));
    return [...all, ...pending.filter((p) => !clientIds.has(p.client_id))];
  }, [pages.data, pending]);
  const lastId = messages.filter((m) => !m.pending).at(-1)?.id;

  const reload = () => qc.invalidateQueries({ queryKey: ['messages', id] });
  useRoom(`conversation:${id}`, {
    'message:new': (d: { conversation_id: string }) => { if (d.conversation_id === id) reload(); },
    'message:updated': (d: { conversation_id: string }) => { if (d.conversation_id === id) reload(); },
    'conversation:receipt': (d: { conversation_id: string }) => { if (d.conversation_id === id) reload(); },
    'conversation:updated': (d: { conversation_id: string }) => { if (d.conversation_id === id) { reload(); qc.invalidateQueries({ queryKey: ['conversation', id] }); } },
    typing: (d: { conversation_id: string; user_id: string; typing: boolean }) => {
      if (d.conversation_id !== id || d.user_id === user?.id) return;
      setTyping((t) => { const n = { ...t }; if (d.typing) n[d.user_id] = Date.now(); else delete n[d.user_id]; return n; });
    },
  });
  useEffect(() => { const t = setInterval(() => setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, at]) => Date.now() - at < 6000))), 2000); return () => clearInterval(t); }, []);
  // Mark as read while the conversation is open and the window is visible.
  useEffect(() => {
    if (!lastId || document.visibilityState !== 'visible') return;
    api(`/api/v1/messages/conversations/${id}/read`, { method: 'POST', body: { message_id: lastId } })
      .then(() => { qc.invalidateQueries({ queryKey: ['unread'] }); qc.invalidateQueries({ queryKey: ['conversations'] }); }).catch(() => undefined);
  }, [id, lastId, qc]);
  useLayoutEffect(() => { if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages.length]);

  const send = async (body: string, attachments: Att[]) => {
    const client_id = `${user!.id.slice(0, 8)}-${crypto.randomUUID?.() ?? Date.now()}`.slice(0, 64);
    const optimistic: Msg = { id: client_id, conversation_id: id, sender_id: user!.id, kind: 'text', body, deleted: false, client_id, attachments,
      reply_to: replyTo ? { id: replyTo.id, sender_id: replyTo.sender_id, body: replyTo.body, deleted: false } : null, reactions: [],
      created_at: new Date().toISOString(), edited_at: null, status: null, pending: true };
    setPending((p) => [...p, optimistic]);
    atBottom.current = true;
    const payload = { body, client_id, reply_to_id: replyTo?.id ?? null, attachment_ids: attachments.map((a) => a.id) };
    setReplyTo(null);
    const attempt = async (): Promise<boolean> => {
      if (socket?.connected) {
        const ack = await socket.timeout(8000).emitWithAck('message:send', { conversation_id: id, ...payload }).catch(() => null) as { ok: boolean; message?: string } | null;
        if (ack?.ok) return true;
        if (ack && !ack.ok) { toast.error(ack.message ?? 'The message could not be sent.'); return false; }
      }
      // REST fallback (same client_id: never duplicated)
      await api(`/api/v1/messages/conversations/${id}/messages`, { method: 'POST', body: payload });
      return true;
    };
    try {
      const ok = await attempt();
      if (!ok) setPending((p) => p.map((m) => (m.client_id === client_id ? { ...m, pending: false, failed: true } : m)));
      await reload();
      if (ok) setPending((p) => p.filter((m) => m.client_id !== client_id));
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The message could not be sent.');
      setPending((p) => p.map((m) => (m.client_id === client_id ? { ...m, pending: false, failed: true } : m)));
    }
  };
  const del = useAction((m: Msg) => api(`/api/v1/messages/${m.id}`, { method: 'DELETE' }), { invalidate: [['messages', id], ['conversations']] });
  const react = useAction(({ m, emoji, on }: { m: Msg; emoji: string; on: boolean }) => api(`/api/v1/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: on ? 'PUT' : 'DELETE' }),
    { invalidate: [['messages', id]] });
  const settings = useAction((body: Partial<Pick<Conv, 'muted' | 'archived' | 'pinned'>>) => api(`/api/v1/messages/conversations/${id}/settings`, { method: 'PUT', body }),
    { invalidate: [['conversations'], ['conversation', id]] });
  const leave = useAction(() => api(`/api/v1/messages/conversations/${id}/members/${user!.id}`, { method: 'DELETE' }), { success: 'You left the conversation.', invalidate: [['conversations']], onSuccess: onBack });
  const block = useAction((uid: string) => api(`/api/v1/messages/blocks/${uid}`, { method: conv.data?.blocked ? 'DELETE' : 'PUT' }), { success: 'Done.', invalidate: [['conversation', id], ['conversations']] });
  const c = conv.data;
  const other = c?.members.find((m) => m.id !== user?.id);
  const typers = Object.keys(typing).map((u) => people[u]?.full_name?.split(' ')[0]).filter(Boolean);

  const onScroll = () => {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && pages.hasNextPage && !pages.isFetchingNextPage) {
      const before = el.scrollHeight;
      pages.fetchNextPage().then(() => requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before + el.scrollTop; }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button size="icon" variant="ghost" className="md:hidden" aria-label="Back" onClick={onBack}><ArrowLeft /></Button>
        {c ? <ConvAvatar c={c} size={40} /> : <Skeleton className="h-10 w-10 rounded-full" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{c?.title}</p>
          <p className="truncate text-xs text-ink-muted">{typers.length ? `${typers.join(', ')} typing…` : c?.kind === 'group' ? `${c.members.length} members` : other?.online ? 'Online' : other ? 'Offline' : ''}</p>
        </div>
        {c && (
          <Menu>
            <MenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Conversation options"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              {c.kind === 'direct' && other && <MenuItem onSelect={() => window.location.assign(`/portal/alumni/${other.id}`)}><Users />View profile</MenuItem>}
              <MenuItem onSelect={() => settings.mutate({ pinned: !c.pinned })}><Pin />{c.pinned ? 'Unpin' : 'Pin'}</MenuItem>
              <MenuItem onSelect={() => settings.mutate({ muted: !c.muted })}><BellOff />{c.muted ? 'Unmute' : 'Mute'}</MenuItem>
              <MenuItem onSelect={() => settings.mutate({ archived: !c.archived })}><Archive />{c.archived ? 'Move to inbox' : 'Archive'}</MenuItem>
              <MenuSeparator />
              {c.kind === 'direct' && other && <MenuItem danger onSelect={async () => { if (c.blocked || await confirm({ title: `Block ${other.full_name}?`, description: 'Neither of you can send messages to the other until you unblock.', confirmLabel: 'Block', danger: true })) block.mutate(other.id); }}><UserMinus />{c.blocked ? 'Unblock' : 'Block'}</MenuItem>}
              {c.kind === 'group' && <MenuItem danger onSelect={async () => { if (await confirm({ title: 'Leave this group chat?', confirmLabel: 'Leave', danger: true })) leave.mutate(undefined); }}><UserMinus />Leave group</MenuItem>}
            </MenuContent>
          </Menu>
        )}
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-canvas/60 px-4 py-4" aria-live="polite">
        {pages.isFetchingNextPage && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-ink-muted" /></div>}
        {pages.isLoading ? <Skeleton className="h-40" /> : messages.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">Say hello 👋</p>
          : messages.map((m, i) => {
            const prev = messages[i - 1];
            const mine = m.sender_id === user?.id;
            const grouped = prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000 && prev.kind !== 'system';
            if (m.kind === 'system') return <p key={m.id} className="py-2 text-center text-xs text-ink-muted">{m.body}</p>;
            const author = m.sender_id ? people[m.sender_id] : null;
            return (
              <div key={m.id} className={cn('group flex gap-2', mine ? 'justify-end' : 'justify-start', !grouped && 'pt-2')}>
                {!mine && <span className="w-8 shrink-0">{!grouped && <Avatar name={author?.full_name} src={photoUrl(author?.photo ?? null, 64)} size={32} />}</span>}
                <div className={cn('flex max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
                  {!mine && !grouped && c?.kind === 'group' && <span className="mb-0.5 text-xs font-medium text-ink-muted">{author?.full_name}</span>}
                  <div className="flex items-center gap-1">
                    {mine && !m.deleted && !m.pending && <MsgActions m={m} mine onReply={() => setReplyTo(m)} onEdit={() => setEditing(m)} onDelete={async () => { if (await confirm({ title: 'Delete for everyone?', confirmLabel: 'Delete', danger: true })) del.mutate(m); }} onReact={(e, on) => react.mutate({ m, emoji: e, on })} />}
                    <div className={cn('rounded-2xl px-3.5 py-2 text-[14.5px]', mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md border border-line bg-surface text-ink', m.failed && 'bg-danger/80')}>
                      {m.reply_to && <p className={cn('mb-1 border-l-2 pl-2 text-xs', mine ? 'border-white/60 text-white/80' : 'border-primary/50 text-ink-muted')}>
                        {m.reply_to.deleted ? 'Deleted message' : `${people[m.reply_to.sender_id ?? '']?.full_name ?? ''}: ${m.reply_to.body}`}</p>}
                      {m.deleted ? <span className="italic opacity-80">Message deleted</span> : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                      {m.attachments.map((a) => <Attachment key={a.id} a={a} mine={mine} />)}
                    </div>
                    {!mine && !m.deleted && <MsgActions m={m} onReply={() => setReplyTo(m)} onReact={(e, on) => react.mutate({ m, emoji: e, on })} />}
                  </div>
                  {m.reactions.length > 0 && (
                    <div className="mt-0.5 flex gap-1">{m.reactions.map((r) => (
                      <button key={r.emoji} onClick={() => react.mutate({ m, emoji: r.emoji, on: !r.mine })}
                        className={cn('rounded-full border px-1.5 text-xs', r.mine ? 'border-primary/40 bg-primary-soft' : 'border-line bg-surface')}>{r.emoji} {r.count}</button>
                    ))}</div>
                  )}
                  <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-muted" title={fmtDateTime(m.created_at)}>
                    {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{m.edited_at && ' · edited'}
                    {mine && (m.failed ? <span className="text-danger">not sent</span> : m.pending ? <Loader2 className="h-3 w-3 animate-spin" />
                      : m.status === 'read' ? <CheckCheck className="h-3.5 w-3.5 text-primary" aria-label="Read" />
                      : m.status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" /> : <Check className="h-3.5 w-3.5" aria-label="Sent" />)}
                  </span>
                </div>
              </div>
            );
          })}
      </div>
      {c?.blocked ? <p className="border-t border-line p-4 text-center text-sm text-ink-muted">You blocked this member. Unblock them to send messages.</p>
        : <MessageBox conversationId={id} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} editing={editing} onDoneEditing={() => setEditing(null)} onSend={send} />}
    </div>
  );
}

function MsgActions({ m, mine, onReply, onEdit, onDelete, onReact }: { m: Msg; mine?: boolean; onReply: () => void; onEdit?: () => void; onDelete?: () => void; onReact: (e: string, on: boolean) => void }) {
  return (
    <div className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
      <Menu>
        <MenuTrigger asChild><button className="rounded p-1 text-ink-muted hover:bg-surface hover:text-ink" aria-label="React"><Smile className="h-4 w-4" /></button></MenuTrigger>
        <MenuContent align={mine ? 'end' : 'start'} className="min-w-0">
          <div className="flex gap-1 p-1">{QUICK.map((e) => <button key={e} className="rounded p-1 text-lg hover:bg-canvas" onClick={() => onReact(e, !m.reactions.find((r) => r.emoji === e && r.mine))}>{e}</button>)}</div>
        </MenuContent>
      </Menu>
      <button className="rounded p-1 text-ink-muted hover:bg-surface hover:text-ink" aria-label="Reply" onClick={onReply}><CornerUpLeft className="h-4 w-4" /></button>
      {mine && onEdit && m.body && <button className="rounded p-1 text-ink-muted hover:bg-surface hover:text-ink" aria-label="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></button>}
      {mine && onDelete && <button className="rounded p-1 text-ink-muted hover:bg-surface hover:text-danger" aria-label="Delete" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}
    </div>
  );
}

/** Attachments are private: fetched with the access token and shown from a blob URL. */
function Attachment({ a, mine }: { a: Att; mine: boolean }) {
  const isImage = a.mime.startsWith('image/');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    api<Response>(a.url, { raw: true }).then((r) => r.blob()).then((b) => { url = URL.createObjectURL(b); setSrc(url); }).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [a.url, isImage]);
  const open = async () => {
    const r = await api<Response>(a.url, { raw: true });
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: a.filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (isImage) return src ? <button onClick={open} className="mt-1 block" aria-label={`Download ${a.filename}`}><img src={src} alt={a.filename} className="max-h-64 rounded-lg" /></button> : <Skeleton className="mt-1 h-32 w-48" />;
  return (
    <button onClick={open} className={cn('mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm', mine ? 'bg-white/15' : 'bg-canvas')}>
      <FileText className="h-5 w-5 shrink-0" /><span className="min-w-0"><span className="block truncate">{a.filename}</span><span className="text-xs opacity-75">{fmtBytes(a.size)}</span></span><Download className="h-4 w-4" />
    </button>
  );
}

function MessageBox({ conversationId, replyTo, onCancelReply, editing, onDoneEditing, onSend }: {
  conversationId: string; replyTo: Msg | null; onCancelReply: () => void; editing: Msg | null; onDoneEditing: () => void;
  onSend: (body: string, attachments: Att[]) => void;
}) {
  const { socket } = useLive();
  const toast = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Att[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  useEffect(() => { if (editing) setBody(editing.body); }, [editing]);
  const ping = (on: boolean) => {
    if (!socket?.connected) return;
    if (on && Date.now() - typingSent.current < 3000) return;
    typingSent.current = on ? Date.now() : 0;
    socket.emit('typing', { conversation_id: conversationId, typing: on });
  };
  const submit = async () => {
    const text = body.trim();
    if (editing) {
      try {
        await api(`/api/v1/messages/${editing.id}`, { method: 'PATCH', body: { body: text } });
        qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not edit the message.'); return; }
      setBody(''); onDoneEditing(); return;
    }
    if (!text && !files.length) return;
    onSend(text, files);
    setBody(''); setFiles([]); ping(false);
  };
  const upload = async (list: FileList | null) => {
    setUploading(true);
    try {
      for (const f of Array.from(list ?? []).slice(0, 10 - files.length)) {
        const fd = new FormData();
        fd.append('file', f);
        const r = await api<{ data: Omit<Att, 'url'> }>('/api/v1/messages/uploads', { method: 'POST', body: fd });
        setFiles((x) => [...x, { ...r.data, url: `/api/v1/messages/attachments/${r.data.id}` }]);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); } finally { setUploading(false); }
  };
  return (
    <div className="border-t border-line p-3">
      {(replyTo || editing) && (
        <p className="mb-2 flex items-center gap-2 rounded-btn bg-canvas px-3 py-1.5 text-xs text-ink-muted">
          {editing ? <><Pencil className="h-3.5 w-3.5" />Editing message</> : <><CornerUpLeft className="h-3.5 w-3.5" /><span className="truncate">Replying to: {replyTo!.body || 'attachment'}</span></>}
          <button className="ml-auto" aria-label="Cancel" onClick={() => { onCancelReply(); onDoneEditing(); setBody(''); }}><X className="h-3.5 w-3.5" /></button>
        </p>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">{files.map((f) => (
          <Badge key={f.id} tone="primary"><Paperclip className="h-3 w-3" />{f.filename}<button aria-label={`Remove ${f.filename}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><X className="h-3 w-3" /></button></Badge>
        ))}</div>
      )}
      <div className="flex items-end gap-2">
        {!editing && <Button size="icon" variant="ghost" aria-label="Attach a file" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}</Button>}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <Textarea aria-label="Message" placeholder="Write a message…" rows={1} value={body} className="max-h-40 min-h-[42px] resize-none py-2.5"
          onChange={(e) => { setBody(e.target.value); ping(!!e.target.value); }} onBlur={() => ping(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } else if (e.key === 'Escape' && editing) { onDoneEditing(); setBody(''); } }} />
        <Button size="icon" aria-label="Send" disabled={uploading || (!body.trim() && !files.length)} onClick={submit}><Send /></Button>
      </div>
    </div>
  );
}

function NewConversation({ kind, onClose }: { kind: 'direct' | 'group'; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const dq = useDebounced(q);
  const people = useQuery({ queryKey: ['connections', 'pick', dq], queryFn: () => api<{ data: PersonCard[] }>(`/api/v1/alumni/connections?type=connected&page_size=50${dq ? `&q=${encodeURIComponent(dq)}` : ''}`) });
  const open = useAction((uid: string) => api<{ data: { id: string } }>('/api/v1/messages/conversations/direct', { method: 'POST', body: { user_id: uid } }),
    { onSuccess: (r) => { onClose(); nav(`/portal/messages/${r.data.id}`); } });
  const group = useAction(() => api<{ data: { id: string } }>('/api/v1/messages/conversations/group', { method: 'POST', body: { title, member_ids: picked } }),
    { invalidate: [['conversations']], onSuccess: (r) => { onClose(); nav(`/portal/messages/${r.data.id}`); } });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={kind === 'direct' ? 'New message' : 'New group chat'}
      description="Choose from your connections. Batchmates can also be messaged from their profile."
      footer={kind === 'group' && <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={group.isPending} disabled={title.trim().length < 2 || !picked.length} onClick={() => group.mutate(undefined)}>Create group</Button></>}>
      <div className="space-y-3">
        {kind === 'group' && <Field label="Group name" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />}</Field>}
        <Input aria-label="Search connections" placeholder="Search connections…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-card border border-line">
          {people.isLoading ? <li className="p-3"><Skeleton className="h-8" /></li> : !people.data?.data.length ? <li className="p-4 text-sm text-ink-muted">No connections found. <Link to="/portal/directory" className="text-primary underline" onClick={onClose}>Find alumni</Link></li>
            : people.data.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.full_name}</span>
                {kind === 'direct' ? <Button size="sm" loading={open.isPending && open.variables === p.id} onClick={() => open.mutate(p.id)}>Message</Button>
                  : <Checkbox checked={picked.includes(p.id)} onCheckedChange={(v) => setPicked((x) => (v ? [...x, p.id] : x.filter((y) => y !== p.id)))} label={<span className="sr-only">Add {p.full_name}</span>} />}
              </li>
            ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** "Message" button for profiles: opens (or creates) the direct conversation. */
export function MessageButton({ userId }: { userId: string }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const open = useAction(() => api<{ data: { id: string } }>('/api/v1/messages/conversations/direct', { method: 'POST', body: { user_id: userId } }),
    { onSuccess: (r) => nav(`/portal/messages/${r.data.id}`) });
  if (!can('portal.message')) return null;
  return <Button variant="outline" loading={open.isPending} onClick={() => open.mutate(undefined)}><Send />Message</Button>;
}

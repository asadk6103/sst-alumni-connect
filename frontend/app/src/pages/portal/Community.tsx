import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import { ApiError, get } from '@/lib/api';
import { Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Comments, PostCard, type PostT } from '@/components/community';

/** One post with its comments (`/portal/community/posts/:id`). */
export function PostPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['post', id], queryFn: () => get<PostT>(`/api/v1/community/posts/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const back = q.data?.group ? { to: `/portal/community/groups/${q.data.group.id}`, label: q.data.group.name } : { to: '/portal', label: 'Feed' };
  return (
    <div className="mx-auto max-w-3xl">
      <Link to={back.to} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{back.label}</Link>
      {q.isLoading ? <Skeleton className="h-64 rounded-card" /> : !q.data ? <Card><EmptyState icon={Users} title="Post not available" description="It may have been deleted, or it belongs to a community you are not in." /></Card> : (
        <div className="space-y-3"><PostCard post={q.data} /><Card className="p-4"><Comments post={q.data} /></Card></div>
      )}
    </div>
  );
}

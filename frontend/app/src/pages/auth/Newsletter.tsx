import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Alert } from '@/components/ui/display';

/** Public landing for the links in newsletter emails: /newsletter/confirm and /newsletter/unsubscribe. */
export function NewsletterPage() {
  const { action } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const valid = action === 'confirm' || action === 'unsubscribe';
  const [state, setState] = useState<'working' | 'ok' | 'error'>(token && valid ? 'working' : 'error');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('This link is incomplete. Open it again from the email.');
  useEffect(() => {
    if (!token || !valid) return;
    api<{ data: { email: string } }>(`/api/v1/public/newsletter/${action}`, { method: 'POST', body: { token }, auth: false })
      .then((r) => { setEmail(r.data.email); setState('ok'); })
      .catch((e) => { setMessage(e instanceof ApiError ? e.message : 'Something went wrong.'); setState('error'); });
  }, [token, action, valid]);
  const title = action === 'unsubscribe' ? 'Unsubscribe' : 'Newsletter subscription';
  return (
    <AuthLayout title={title} footer={<Link to="/" className="font-medium text-primary hover:underline">Go to the alumni website</Link>}>
      {state === 'working' && <p className="text-center text-sm text-ink-muted">One moment…</p>}
      {state === 'ok' && (action === 'unsubscribe'
        ? <Alert tone="success" title="You are unsubscribed">{email} will no longer receive the newsletter. Changed your mind? Subscribe again from the website or your account.</Alert>
        : <Alert tone="success" title="Subscription confirmed">Thank you — {email} will receive the alumni newsletter.</Alert>)}
      {state === 'error' && <Alert tone="danger" title="We could not complete this">{message}</Alert>}
    </AuthLayout>
  );
}

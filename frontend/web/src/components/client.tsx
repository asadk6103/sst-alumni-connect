'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Languages, Menu, Send, X } from 'lucide-react';

type Msgs = Record<string, string>;

async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, message: j?.error?.message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, message: 'You appear to be offline. Please try again.' };
  }
}

export function LanguageSwitch({ lang, languages, label }: { lang: string; languages: { code: string; native_name: string }[]; label: string }) {
  const router = useRouter();
  if (languages.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-white/85">
      <Languages className="h-4 w-4" aria-hidden /><span className="sr-only">{label}</span>
      <select value={lang} className="cursor-pointer appearance-none bg-transparent font-medium focus:outline-none [&>option]:text-ink" onChange={(e) => {
        document.cookie = `sst-lang=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        try { localStorage.setItem('sst-lang', e.target.value); } catch { /* private mode */ }
        router.refresh();
      }}>
        {languages.map((l) => <option key={l.code} value={l.code}>{l.native_name}</option>)}
      </select>
    </label>
  );
}

export function MobileMenu({ links, signIn, join }: { links: { label: string; href: string; new_tab: boolean }[]; signIn: string; join: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button type="button" className="rounded-btn p-2 hover:bg-white/10" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      {open && (
        <nav aria-label="Main" className="absolute inset-x-0 top-full z-40 border-t border-white/10 bg-navy px-4 py-3 shadow-lg">
          {links.map((l) => <a key={l.href + l.label} href={l.href} target={l.new_tab ? '_blank' : undefined} rel={l.new_tab ? 'noopener noreferrer' : undefined} className="block rounded-btn px-3 py-2.5 text-sm hover:bg-white/10">{l.label}</a>)}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-3">
            <a href="/login" className="flex-1 rounded-btn bg-primary px-3 py-2 text-center text-sm font-medium">{signIn}</a>
            <a href="/register" className="flex-1 rounded-btn border border-white/60 px-3 py-2 text-center text-sm font-medium">{join}</a>
          </div>
        </nav>
      )}
    </div>
  );
}

export function NewsletterForm({ m, dark }: { m: Msgs; dark?: boolean }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    setError(null);
    const r = await post('/api/v1/public/newsletter/subscribe', { email });
    if (r.ok) setState('done');
    else { setError(r.message ?? null); setState('idle'); }
  };
  if (state === 'done') return <p className={`flex items-center gap-2 text-sm ${dark ? 'text-white' : 'text-success'}`} role="status"><CheckCircle2 className="h-5 w-5" />{m.done}</p>;
  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row" noValidate>
      <label className="sr-only" htmlFor="nl-email">{m.email}</label>
      <input id="nl-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" dir="ltr"
        className="h-11 flex-1 rounded-btn border border-line bg-white px-3 text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/25" />
      <button type="submit" disabled={state === 'busy' || !/\S+@\S+\.\S+/.test(email)} className="h-11 rounded-btn bg-primary px-5 font-medium text-white hover:bg-primary/90 disabled:opacity-60">{m.subscribe}</button>
      {error && <p className="text-sm text-red-600 sm:basis-full" role="alert">{error}</p>}
    </form>
  );
}

export function ContactForm({ m }: { m: Msgs }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', subject: '', message: '', website: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    setError(null);
    const r = await post('/api/v1/public/contact', { ...f, phone: f.phone || null, website: f.website || null });
    if (r.ok) setState('done');
    else { setError(r.message ?? null); setState('idle'); }
  };
  if (state === 'done') return <div className="flex items-start gap-3 rounded-card border border-success/30 bg-success/10 p-4 text-sm text-ink" role="status"><CheckCircle2 className="h-5 w-5 shrink-0 text-success" />{m.sent}</div>;
  const input = 'h-11 w-full rounded-btn border border-line bg-white px-3 text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/25';
  const valid = f.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && f.subject.trim().length >= 2 && f.message.trim().length >= 10;
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <label className="text-sm font-medium text-ink">{m.name}<input className={`${input} mt-1`} required value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
      <label className="text-sm font-medium text-ink">{m.email}<input className={`${input} mt-1`} type="email" dir="ltr" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
      <label className="text-sm font-medium text-ink">{m.phone}<input className={`${input} mt-1`} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></label>
      <label className="text-sm font-medium text-ink">{m.subject}<input className={`${input} mt-1`} required value={f.subject} maxLength={200} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
      <label className="text-sm font-medium text-ink sm:col-span-2">{m.message}<textarea className={`${input} mt-1 h-36 py-2`} required value={f.message} maxLength={5000} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      {/* honeypot: hidden from people, tempting for bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
      {error && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{error}</p>}
      <div className="sm:col-span-2"><button type="submit" disabled={!valid || state === 'busy'} className="inline-flex h-11 items-center gap-2 rounded-btn bg-primary px-5 font-medium text-white hover:bg-primary/90 disabled:opacity-60"><Send className="h-4 w-4" />{m.send}</button></div>
    </form>
  );
}

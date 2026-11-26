import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name?: string | null) {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

type FormatPrefs = { date: string; time: '12' | '24'; tz?: string };
let fmt: FormatPrefs = { date: 'DD MMM, YYYY', time: '12' };
/** Member's date format, 12/24-hour clock and time zone (Settings › Language & Region). */
export function setFormatPrefs(p: FormatPrefs) { fmt = p; }

const dtf = (opts: Intl.DateTimeFormatOptions) => {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, ...(fmt.tz ? { timeZone: fmt.tz } : {}) }); } catch { return new Intl.DateTimeFormat(undefined, opts); }
};

function datePart(d: Date) {
  const parts = Object.fromEntries(dtf({ day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  const num = Object.fromEntries(dtf({ day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  switch (fmt.date) {
    case 'MMM DD, YYYY': return `${parts.month} ${parts.day}, ${parts.year}`;
    case 'DD/MM/YYYY': return `${num.day}/${num.month}/${num.year}`;
    case 'YYYY-MM-DD': return `${num.year}-${num.month}-${num.day}`;
    default: return `${parts.day} ${parts.month}, ${parts.year}`;
  }
}

export function fmtTime(value?: string | Date | null) {
  if (!value) return '';
  return dtf({ hour: 'numeric', minute: '2-digit', hour12: fmt.time !== '24' }).format(new Date(value));
}

export function fmtDate(value?: string | null) {
  if (!value) return '—';
  return datePart(new Date(value));
}

export function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  return `${datePart(new Date(value))}, ${fmtTime(value)}`;
}

export function timeAgo(value?: string | null) {
  if (!value) return '—';
  const s = (Date.now() - new Date(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 60) return rtf.format(-Math.round(s), 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), 'day');
  return fmtDate(value);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '0 0 0';
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

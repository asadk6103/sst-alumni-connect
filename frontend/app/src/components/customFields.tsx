import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';

export type FieldType = 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'file' | 'url';
export type CustomFieldDef = {
  id: string; entity: string; key: string; label: string; labels: Record<string, string>; help_text: string; type: FieldType;
  options: { value: string; label: string }[]; required: boolean; visibility: 'public' | 'members' | 'connections' | 'private';
  validation: { min_length?: number; max_length?: number; min?: number | string; max?: number | string; pattern?: string; message?: string };
  condition: { field: string; operator: 'equals' | 'not_equals' | 'in' | 'filled'; value: string | string[] | null } | null;
  on_registration: boolean; position: number; active: boolean;
};
export type CustomValues = Record<string, unknown>;
export type ExtraField = { key: string; label: string; type: FieldType; value: unknown; display: string };

/** Active custom fields of a form (members), or the registration questions (public). */
export function useCustomFields(entity: string, opts: { registration?: boolean; enabled?: boolean } = {}) {
  const { lang } = useI18n();
  return useQuery({
    queryKey: ['custom-fields', entity, opts.registration ?? false, lang],
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    queryFn: () => api<{ data: CustomFieldDef[] }>(opts.registration
      ? `/api/v1/public/custom-fields/registration?lang=${lang}` : `/api/v1/custom-fields/${entity}?lang=${lang}`,
    { auth: !opts.registration }).then((r) => r.data),
  });
}

const norm = (x: unknown) => (typeof x === 'boolean' ? (x ? 'true' : 'false') : String(x));

/** Same rule as the server: is a conditional field shown for these answers? */
export function conditionMet(f: CustomFieldDef, values: CustomValues): boolean {
  const c = f.condition;
  if (!c?.field) return true;
  const other = values[c.field];
  const present = !(other === undefined || other === null || other === '' || other === false || (Array.isArray(other) && !other.length));
  if (c.operator === 'filled') return present;
  const wanted = new Set((Array.isArray(c.value) ? c.value : [c.value]).map(norm));
  const got = Array.isArray(other) ? other.map(norm) : other === undefined || other === null ? [] : [norm(other)];
  const hit = got.some((g) => wanted.has(g));
  return c.operator === 'not_equals' ? !hit : hit;
}

/** Renders a form's custom fields; values are kept by field key. Errors come from the API as `custom_fields.<key>`. */
export function CustomFieldsForm({ defs, value, onChange, errors = {}, columns = 2 }: {
  defs: CustomFieldDef[]; value: CustomValues; onChange: (v: CustomValues) => void; errors?: Record<string, string>; columns?: 1 | 2;
}) {
  const visible = defs.filter((f) => conditionMet(f, value));
  if (!visible.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className={columns === 2 ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
      {visible.map((f) => {
        const err = errors[`custom_fields.${f.key}`];
        const wide = ['textarea', 'multiselect', 'radio', 'checkbox', 'file'].includes(f.type);
        const v = value[f.key];
        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className={wide && columns === 2 ? 'sm:col-span-2' : ''}>
              <Checkbox checked={v === true} onCheckedChange={(c) => set(f.key, c)} label={<>{f.label}{f.required && <span className="text-danger"> *</span>}</>} />
              {f.help_text && <p className="ms-6 mt-1 text-xs text-ink-muted">{f.help_text}</p>}
              {err && <p className="ms-6 mt-1 text-xs text-danger" role="alert">{err}</p>}
            </div>
          );
        }
        return (
          <Field key={f.key} label={f.label} required={f.required} hint={f.help_text || undefined} error={err} className={wide && columns === 2 ? 'sm:col-span-2' : ''}>
            {(id, describedBy) => <Control id={id} describedBy={describedBy} f={f} v={v} set={(x) => set(f.key, x)} />}
          </Field>
        );
      })}
    </div>
  );
}

function Control({ id, describedBy, f, v, set }: { id: string; describedBy?: string; f: CustomFieldDef; v: unknown; set: (v: unknown) => void }) {
  const common = { id, 'aria-describedby': describedBy };
  const str = v === undefined || v === null ? '' : String(v);
  switch (f.type) {
    case 'textarea':
      return <Textarea {...common} value={str} maxLength={f.validation.max_length ?? 5000} onChange={(e) => set(e.target.value)} />;
    case 'number':
      return <Input {...common} type="number" inputMode="decimal" value={str} min={f.validation.min as number | undefined} max={f.validation.max as number | undefined}
        onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
      return <Input {...common} type="date" value={str} min={f.validation.min as string | undefined} max={f.validation.max as string | undefined} onChange={(e) => set(e.target.value)} />;
    case 'select':
      return (
        <Select {...common} value={str} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    case 'radio':
      return (
        <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
          {f.options.map((o) => (
            <label key={o.value} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="radio" name={`${id}-${f.key}`} checked={str === o.value} onChange={() => set(o.value)} className="h-4 w-4 accent-[rgb(var(--primary))]" />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'multiselect': {
      const list = Array.isArray(v) ? (v as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2 pt-1" id={id}>
          {f.options.map((o) => {
            const on = list.includes(o.value);
            return (
              <button key={o.value} type="button" aria-pressed={on} onClick={() => set(on ? list.filter((x) => x !== o.value) : [...list, o.value])}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line text-ink hover:bg-canvas'}`}>
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'file':
      return <FileControl id={id} value={str} set={set} />;
    default:
      return <Input {...common} type={f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text'}
        dir={['email', 'url', 'phone'].includes(f.type) ? 'ltr' : undefined}
        value={str} maxLength={f.validation.max_length ?? 500} onChange={(e) => set(e.target.value)} />;
  }
}

function FileControl({ id, value, set }: { id: string; value: string; set: (v: unknown) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ data: { id: string; filename: string } }>('/api/v1/custom-fields/files', { method: 'POST', body: fd });
      set(r.data.id);
      setName(r.data.filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input ref={ref} id={id} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => ref.current?.click()}><Upload />{value ? 'Replace file' : 'Upload file'}</Button>
      {value && <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted"><Paperclip className="h-4 w-4" />{name ?? 'File attached'}</span>}
      {value && <button type="button" className="text-sm text-danger hover:underline" onClick={() => { set(''); setName(null); }}>Remove</button>}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
      <p className="w-full text-xs text-ink-muted">Kept private — only people allowed to see this field can open it.</p>
    </div>
  );
}

/** Read-only list of custom field values (already filtered by the server for this viewer). */
export function ExtraFields({ items, fileHref, className = '' }: { items?: ExtraField[] | null; fileHref?: (key: string) => string; className?: string }) {
  if (!items?.length) return null;
  return (
    <dl className={`grid gap-x-6 gap-y-3 sm:grid-cols-2 ${className}`}>
      {items.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{f.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">
            {f.type === 'file' && fileHref ? <FileLink href={fileHref(f.key)} />
              : f.type === 'url' ? <a href={String(f.value)} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline" dir="ltr">{String(f.value)}</a>
                : f.display}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FileLink({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const { download } = await import('@/lib/api');
      await download(href, 'attachment');
    } finally {
      setBusy(false);
    }
  };
  return <button type="button" onClick={open} disabled={busy} className="inline-flex items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4" />Open file</button>;
}

/** Field errors for the custom section only (keys like custom_fields.x). */
export function customErrors(errors: Record<string, string>) {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('custom_fields.')));
}

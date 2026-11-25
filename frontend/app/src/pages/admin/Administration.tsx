import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Download, FileSpreadsheet, FileText, GripVertical, Languages, ListPlus, Pencil, Plus, Printer, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { api, download, get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm, useToast } from '@/components/ui/overlay';
import { Chart, type ChartData } from '@/components/charts';
import { CustomFieldsForm, type CustomFieldDef, type CustomValues, type FieldType } from '@/components/customFields';

// ── custom fields ───────────────────────────────────────────────────────────
const ENTITIES: [string, string][] = [['alumni_profile', 'Alumni profiles & registration'], ['job_post', 'Job postings'], ['event', 'Events'], ['mentor', 'Mentor profiles'], ['donation', 'Donations']];
const TYPES: [FieldType, string][] = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['email', 'Email'], ['phone', 'Phone'], ['date', 'Date'], ['select', 'Dropdown'],
  ['multiselect', 'Multi-select'], ['checkbox', 'Checkbox'], ['radio', 'Radio buttons'], ['file', 'File upload'], ['url', 'Web address']];
const VIS: [string, string][] = [['members', 'All members'], ['connections', 'Connections (profiles) / members'], ['private', 'Owner and staff only'], ['public', 'Public']];

export function CustomFieldsAdminPage() {
  const { can } = useAuth();
  const [entity, setEntity] = useState('alumni_profile');
  const [editing, setEditing] = useState<CustomFieldDef | 'new' | null>(null);
  const [preview, setPreview] = useState(false);
  const q = useQuery({ queryKey: ['admin-custom-fields', entity], queryFn: () => get<CustomFieldDef[]>(`/api/v1/admin/custom-fields?entity=${entity}`) });
  const [order, setOrder] = useState<CustomFieldDef[]>([]);
  useEffect(() => { if (q.data) setOrder(q.data); }, [q.data]);
  const dragFrom = useRef<number | null>(null);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editable = can('custom_fields.configure');
  const reorder = useAction((ids: string[]) => api('/api/v1/admin/custom-fields/order', { method: 'PUT', body: { entity, ids } }), { success: 'Order saved.', invalidate: [['admin-custom-fields', entity], ['custom-fields']] });
  const del = useAction((id: string) => api(`/api/v1/admin/custom-fields/${id}`, { method: 'DELETE' }), { success: 'Field deleted.', invalidate: [['admin-custom-fields', entity], ['custom-fields']] });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const c = [...order]; const [x] = c.splice(from, 1); c.splice(to, 0, x!); setOrder(c); reorder.mutate(c.map((f) => f.id));
  };
  return (
    <>
      <PageHeader title="Custom fields" description="Add questions to forms without code or database changes. Answers are validated on the server and shown according to each field's visibility."
        actions={<><Button variant="outline" onClick={() => setPreview(true)}>Preview form</Button>{editable && <Button onClick={() => setEditing('new')}><Plus />Add field</Button>}</>} />
      <Tabs value={entity} onValueChange={setEntity} tabs={ENTITIES.map(([v, l]) => ({ value: v, label: l }))}><span /></Tabs>
      {editing && <FieldDialog entity={entity} field={editing === 'new' ? null : editing} others={order} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-custom-fields', entity] }); qc.invalidateQueries({ queryKey: ['custom-fields'] }); }} />}
      {preview && <PreviewForm defs={order.filter((f) => f.active)} onClose={() => setPreview(false)} />}
      <Card className="mt-5">
        {q.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !order.length ? (
          <EmptyState icon={ListPlus} title="No custom fields on this form" description="Standard fields are always asked. Add extra questions such as blood group, house name or T-shirt size." />
        ) : (
          <ul className="divide-y divide-line">
            {order.map((f, i) => (
              <li key={f.id} className={cn('flex items-center gap-3 px-4 py-3', !f.active && 'opacity-60')} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}>
                {editable && <span draggable onDragStart={() => { dragFrom.current = i; }} className="cursor-grab text-ink-muted" title="Drag to reorder"><GripVertical className="h-4 w-4" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">{f.label}{f.required && <Badge tone="warning">Required</Badge>}{!f.active && <Badge>Off</Badge>}
                    {f.on_registration && <Badge tone="primary">Registration</Badge>}{f.condition && <Badge>Conditional</Badge>}</p>
                  <p className="text-xs text-ink-muted"><span dir="ltr">{f.key}</span> · {TYPES.find(([t]) => t === f.type)?.[1]} · visible to {VIS.find(([v]) => v === f.visibility)?.[1].toLowerCase()}</p>
                </div>
                {editable && <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${f.label}`} onClick={async () => { if (await confirm({ title: `Delete “${f.label}”?`, description: 'Answers already given are kept but no longer shown. To hide it temporarily, turn it off instead.', danger: true, confirmLabel: 'Delete' })) del.mutate(f.id); }}><Trash2 /></Button>
                </div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function FieldDialog({ entity, field, others, onClose, onSaved }: { entity: string; field: CustomFieldDef | null; others: CustomFieldDef[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    key: field?.key ?? '', label: field?.label ?? '', ur: field?.labels.ur ?? '', help_text: field?.help_text ?? '', type: field?.type ?? 'text' as FieldType,
    options: field?.options ?? [], required: field?.required ?? false, visibility: field?.visibility ?? 'members', on_registration: field?.on_registration ?? false,
    active: field?.active ?? true, validation: field?.validation ?? {}, condition: field?.condition ?? null,
  });
  const [keyTouched, setKeyTouched] = useState(!!field);
  const choice = ['select', 'multiselect', 'radio'].includes(f.type);
  const save = useAction(() => {
    const body = { entity, key: f.key, label: f.label, labels: f.ur ? { ur: f.ur } : {}, help_text: f.help_text, type: f.type, options: choice ? f.options : [],
      required: f.required, visibility: f.visibility, on_registration: entity === 'alumni_profile' && f.type !== 'file' && f.on_registration, active: f.active,
      validation: Object.fromEntries(Object.entries(f.validation).filter(([, v]) => v !== '' && v !== null && v !== undefined)), condition: f.condition?.field ? f.condition : null };
    return field ? api(`/api/v1/admin/custom-fields/${field.id}`, { method: 'PUT', body }) : api('/api/v1/admin/custom-fields', { method: 'POST', body });
  }, { success: 'Field saved.', onSuccess: () => { onSaved(); onClose(); } });
  const e = save.fieldErrors;
  const v = f.validation as Record<string, unknown>;
  const setV = (k: string, val: unknown) => setF({ ...f, validation: { ...f.validation, [k]: val } });
  const condField = others.find((o) => o.key === f.condition?.field);
  const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 60);
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()} wide title={field ? `Edit “${field.label}”` : 'Add a field'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.label.trim() || f.key.length < 2} onClick={() => save.mutate(undefined)}><Save />Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && <Alert tone="danger" className="sm:col-span-2">{save.error.message}</Alert>}
        <Field label="Label" required error={e.label}>{(id) => <Input id={id} value={f.label} maxLength={150} onChange={(x) => setF({ ...f, label: x.target.value, key: keyTouched ? f.key : keyOf(x.target.value) })} />}</Field>
        <Field label="Label in Urdu">{(id) => <Input id={id} dir="rtl" value={f.ur} maxLength={150} onChange={(x) => setF({ ...f, ur: x.target.value })} />}</Field>
        <Field label="Key" hint={field ? 'Cannot change — stored answers use it.' : 'Machine name, e.g. blood_group.'} error={e.key}>{(id, d) => <Input id={id} aria-describedby={d} dir="ltr" disabled={!!field} value={f.key} onChange={(x) => { setKeyTouched(true); setF({ ...f, key: keyOf(x.target.value) }); }} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.type} onChange={(x) => setF({ ...f, type: x.target.value as FieldType })}>{TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</Select>}</Field>
        <Field label="Help text" className="sm:col-span-2">{(id) => <Input id={id} value={f.help_text} maxLength={300} onChange={(x) => setF({ ...f, help_text: x.target.value })} />}</Field>
        {choice && (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[13px] font-medium text-ink">Options</p>
            {e.options && <p className="text-xs text-danger">{e.options}</p>}
            {f.options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label="Option label" placeholder="Label" value={o.label} onChange={(x) => setF({ ...f, options: f.options.map((p, j) => (j === i ? { label: x.target.value, value: p.value && p.value !== keyOf(p.label) ? p.value : keyOf(x.target.value) || String(i + 1) } : p)) })} />
                <Input aria-label="Stored value" placeholder="value" dir="ltr" className="max-w-[160px]" value={o.value} onChange={(x) => setF({ ...f, options: f.options.map((p, j) => (j === i ? { ...p, value: x.target.value.slice(0, 100) } : p)) })} />
                <Button size="icon" variant="ghost" aria-label="Remove option" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setF({ ...f, options: [...f.options, { label: '', value: '' }] })}><Plus />Add option</Button>
          </div>
        )}
        <Field label="Who can see answers">{(id) => <Select id={id} value={f.visibility} onChange={(x) => setF({ ...f, visibility: x.target.value as CustomFieldDef['visibility'] })}>{VIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <div className="space-y-2 pt-6">
          <Checkbox checked={f.required} onCheckedChange={(x) => setF({ ...f, required: x })} label="Required" />
          <Checkbox checked={f.active} onCheckedChange={(x) => setF({ ...f, active: x })} label="Active (shown on the form)" />
          {entity === 'alumni_profile' && f.type !== 'file' && <Checkbox checked={f.on_registration} onCheckedChange={(x) => setF({ ...f, on_registration: x })} label="Also ask when registering" />}
        </div>
        <fieldset className="rounded-card border border-line p-3 sm:col-span-2">
          <legend className="px-1 text-[13px] font-medium text-ink">Validation</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {['text', 'textarea', 'email', 'phone', 'url'].includes(f.type) && <>
              <Field label="Min length">{(id) => <Input id={id} type="number" min={0} value={String(v.min_length ?? '')} onChange={(x) => setV('min_length', x.target.value ? Number(x.target.value) : '')} />}</Field>
              <Field label="Max length">{(id) => <Input id={id} type="number" min={1} value={String(v.max_length ?? '')} onChange={(x) => setV('max_length', x.target.value ? Number(x.target.value) : '')} />}</Field>
              <Field label="Pattern (regular expression)" error={e['validation.pattern']}>{(id) => <Input id={id} dir="ltr" value={String(v.pattern ?? '')} onChange={(x) => setV('pattern', x.target.value)} placeholder="e.g. [A-Z]{2}-\d{4}" />}</Field></>}
            {['number', 'date', 'multiselect'].includes(f.type) && <>
              <Field label={f.type === 'multiselect' ? 'Choose at least' : 'Minimum'}>{(id) => <Input id={id} type={f.type === 'date' ? 'date' : 'number'} value={String(v.min ?? '')} onChange={(x) => setV('min', f.type === 'date' ? x.target.value : x.target.value ? Number(x.target.value) : '')} />}</Field>
              <Field label={f.type === 'multiselect' ? 'Choose at most' : 'Maximum'}>{(id) => <Input id={id} type={f.type === 'date' ? 'date' : 'number'} value={String(v.max ?? '')} onChange={(x) => setV('max', f.type === 'date' ? x.target.value : x.target.value ? Number(x.target.value) : '')} />}</Field></>}
            <Field label="Error message" className={['select', 'radio', 'checkbox', 'file'].includes(f.type) ? 'sm:col-span-3' : ''}>{(id) => <Input id={id} value={String(v.message ?? '')} maxLength={200} onChange={(x) => setV('message', x.target.value)} placeholder="Optional" />}</Field>
          </div>
        </fieldset>
        <fieldset className="rounded-card border border-line p-3 sm:col-span-2">
          <legend className="px-1 text-[13px] font-medium text-ink">Show only when…</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Another field" error={e['condition.field']}>{(id) => <Select id={id} value={f.condition?.field ?? ''} onChange={(x) => setF({ ...f, condition: x.target.value ? { field: x.target.value, operator: 'equals', value: '' } : null })}>
              <option value="">Always show</option>{others.filter((o) => o.key !== f.key).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</Select>}</Field>
            {f.condition && <>
              <Field label="Is">{(id) => <Select id={id} value={f.condition!.operator} onChange={(x) => setF({ ...f, condition: { ...f.condition!, operator: x.target.value as 'equals' } })}>
                <option value="equals">equal to</option><option value="not_equals">not equal to</option><option value="filled">filled in</option></Select>}</Field>
              {f.condition.operator !== 'filled' && <Field label="Value">{(id) => condField?.options.length
                ? <Select id={id} value={String(f.condition!.value ?? '')} onChange={(x) => setF({ ...f, condition: { ...f.condition!, value: x.target.value } })}><option value="">Choose…</option>{condField.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                : condField?.type === 'checkbox' ? <Select id={id} value={String(f.condition!.value ?? '')} onChange={(x) => setF({ ...f, condition: { ...f.condition!, value: x.target.value } })}><option value="true">Ticked</option><option value="false">Not ticked</option></Select>
                  : <Input id={id} value={String(f.condition!.value ?? '')} onChange={(x) => setF({ ...f, condition: { ...f.condition!, value: x.target.value } })} />}</Field>}
            </>}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function PreviewForm({ defs, onClose }: { defs: CustomFieldDef[]; onClose: () => void }) {
  const [v, setV] = useState<CustomValues>({});
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()} wide title="Form preview" description="How members see these fields (answers here are not saved). Conditional fields appear as you answer.">
      {defs.length ? <CustomFieldsForm defs={defs} value={v} onChange={setV} /> : <p className="text-sm text-ink-muted">No active fields.</p>}
    </Dialog>
  );
}

// ── localization (Configuration section) ───────────────────────────────────
type Lang = { code: string; name: string; native_name: string; rtl: boolean; enabled: boolean; position: number; overrides: number; translated: number; is_default: boolean };
type Row = { key: string; source: string; default: string; value: string; overridden: boolean; untranslated: boolean };

export function LocalizationPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const langs = useQuery({ queryKey: ['admin-languages'], queryFn: () => api<{ data: Lang[]; meta: { keys: number } }>('/api/v1/admin/localization/languages') });
  const [code, setCode] = useState('ur');
  const [adding, setAdding] = useState(false);
  const editable = can('settings.configure');
  const qc = useQueryClient();
  const toggle = useAction((l: Lang) => api(`/api/v1/admin/localization/languages/${l.code}`, { method: 'PUT', body: { ...l, enabled: !l.enabled } }), { success: 'Saved.', invalidate: [['admin-languages'], ['languages']] });
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Languages" icon={Languages} description="Members choose their language from the menu; Urdu and other right-to-left languages flip the layout. The administration console stays in English."
          action={editable && <Button size="sm" onClick={() => setAdding(true)}><Plus />Add language</Button>} />
        {adding && <AddLanguage onClose={() => setAdding(false)} />}
        <ul className="divide-y divide-line">
          {langs.data?.data.map((l) => (
            <li key={l.code} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium text-ink">{l.name} <span className="text-ink-muted" dir={l.rtl ? 'rtl' : 'ltr'}>· {l.native_name}</span></p>
                <p className="text-xs text-ink-muted">{l.code}{l.rtl ? ' · right-to-left' : ''}{l.is_default ? ' · default language' : ''} · {l.overrides} custom translation{l.overrides === 1 ? '' : 's'}</p></div>
              <Switch checked={l.enabled} disabled={!editable || l.code === 'en' || l.is_default} onCheckedChange={() => toggle.mutate(l)} label={l.enabled ? 'On' : 'Off'} />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Translations" description="Edit any interface text. Leave a box empty to go back to the built-in text."
          action={<div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Language" value={code} onChange={(e) => setCode(e.target.value)} className="w-auto">{langs.data?.data.filter((l) => l.code !== 'en').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</Select>
            <Button size="sm" variant="outline" onClick={() => download(`/api/v1/admin/localization/translations/${code}/export`, `translations-${code}.csv`)}><Download />CSV</Button>
            {editable && <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload />Import</Button>}
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              const fd = new FormData(); fd.append('file', file);
              try { const r = await api<{ data: { saved: number; skipped: number } }>(`/api/v1/admin/localization/translations/${code}/import`, { method: 'POST', body: fd });
                toast.success(`${r.data.saved} saved, ${r.data.skipped} skipped.`); qc.invalidateQueries({ queryKey: ['translations'] }); qc.invalidateQueries({ queryKey: ['i18n'] });
              } catch (err) { toast.error(err instanceof Error ? err.message : 'Import failed.'); }
            }} />
          </div>} />
        {code && <TranslationTable key={code} code={code} editable={editable} rtl={!!langs.data?.data.find((l) => l.code === code)?.rtl} />}
      </Card>
    </div>
  );
}

function AddLanguage({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ code: '', name: '', native_name: '', rtl: false });
  const save = useAction(() => api('/api/v1/admin/localization/languages', { method: 'POST', body: { ...f, enabled: true, position: 10 } }), { success: 'Language added — translate it below.', invalidate: [['admin-languages'], ['languages']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Add a language" description="It starts with the English text; translate it in the table."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint="e.g. ar, pa, ps" error={save.fieldErrors.code}>{(id, d) => <Input id={id} aria-describedby={d} dir="ltr" value={f.code} maxLength={5} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} />}</Field>
        <Field label="Name in English">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Name in the language">{(id) => <Input id={id} value={f.native_name} onChange={(e) => setF({ ...f, native_name: e.target.value })} />}</Field>
        <div className="pt-6"><Checkbox checked={f.rtl} onCheckedChange={(v) => setF({ ...f, rtl: v })} label="Written right-to-left" /></div>
      </div>
    </Dialog>
  );
}

function TranslationTable({ code, editable, rtl }: { code: string; editable: boolean; rtl: boolean }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [missing, setMissing] = useState(false);
  const dq = useDebounced(q);
  const rows = useQuery({ queryKey: ['translations', code, dq, group, missing], queryFn: () => api<{ data: Row[]; meta: { groups: string[]; total: number } }>(`/api/v1/admin/localization/translations/${code}${qs({ q: dq || null, group: group || null, missing: missing || null })}`) });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useAction(() => api(`/api/v1/admin/localization/translations/${code}`, { method: 'PUT', body: Object.entries(edits).map(([key, value]) => ({ key, value })) }),
    { success: 'Translations saved.', invalidate: [['translations', code], ['i18n'], ['admin-languages']], onSuccess: () => setEdits({}) });
  const n = Object.keys(edits).length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input className="ps-9" placeholder="Search text or key…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select aria-label="Area" value={group} onChange={(e) => setGroup(e.target.value)} className="w-auto"><option value="">All areas</option>{rows.data?.meta.groups.map((g) => <option key={g} value={g}>{g}</option>)}</Select>
        <Checkbox checked={missing} onCheckedChange={setMissing} label="Untranslated only" />
        {editable && <Button size="sm" disabled={!n} loading={save.isPending} onClick={() => save.mutate(undefined)}><Save />Save{n ? ` (${n})` : ''}</Button>}
      </div>
      {rows.isLoading ? <div className="p-4"><Skeleton className="h-60" /></div> : !rows.data?.data.length ? <EmptyState icon={Languages} title="Nothing matches" /> : (
        <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
          {rows.data.data.map((r) => (
            <div key={r.key} className="grid gap-2 px-4 py-2.5 sm:grid-cols-2 sm:items-center">
              <div className="min-w-0"><p className="text-sm text-ink">{r.source}</p><p className="truncate text-[11px] text-ink-muted" dir="ltr">{r.key}{r.overridden && ' · customised'}</p></div>
              <Textarea aria-label={`Translation of ${r.source}`} dir={rtl ? 'rtl' : 'ltr'} disabled={!editable} rows={1}
                className={cn('min-h-[38px] py-1.5', r.untranslated && !(r.key in edits) && 'border-warning/60')}
                value={edits[r.key] ?? r.value} onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── reports ─────────────────────────────────────────────────────────────────
type ReportMeta = { key: string; title: string; description: string };
type Report = ReportMeta & { period: string; date_from: string; date_to: string; suppressed: boolean; notes?: string; summary: { label: string; value: string | number }[];
  chart: ChartData; columns: { key: string; label: string; type?: 'number' | 'percent' | 'money' }[]; rows: (string | number)[][] };

const PRESETS: [string, string, number][] = [['30d', 'Last 30 days', 30], ['90d', 'Last 3 months', 91], ['12m', 'Last 12 months', 365], ['all', 'Since the beginning', 0]];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsPage() {
  const { key } = useParams();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => get<ReportMeta[]>('/api/v1/admin/reports') });
  if (!key) {
    return (
      <>
        <PageHeader title="Reports & analytics" description="Figures and trends with date filters, charts and exports. Reports never list personal details." />
        {!list.data ? <Skeleton className="h-80 rounded-card" /> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.map((r) => (
              <button key={r.key} type="button" onClick={() => nav(`/admin/reports/${r.key}`)} className="rounded-card border border-line bg-surface p-5 text-start shadow-card transition-shadow hover:shadow-md">
                <BarChart3 className="h-5 w-5 text-primary" /><p className="mt-3 font-medium text-ink">{r.title}</p><p className="mt-1 text-sm text-ink-muted">{r.description}</p>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }
  return <ReportView key={key} reportKey={key} all={list.data ?? []} />;
}

function ReportView({ reportKey, all }: { reportKey: string; all: ReportMeta[] }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const today = new Date();
  const [range, setRange] = useState({ preset: '12m', from: iso(new Date(today.getTime() - 365 * 86400000)), to: iso(today) });
  const params = qs({ date_from: range.preset === 'all' ? '2000-01-01' : range.from, date_to: range.to });
  const q = useQuery({ queryKey: ['report', reportKey, params], queryFn: () => get<Report>(`/api/v1/admin/reports/${reportKey}${params}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const exp = async (format: string) => {
    setBusy(format);
    try { await download(`/api/v1/admin/reports/${reportKey}/export${params}&format=${format}`, `${reportKey}.${format}`); } finally { setBusy(null); }
  };
  const r = q.data;
  const cell = (v: string | number, type?: string) => typeof v === 'number' ? (type === 'percent' ? `${v}%` : type === 'money' ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toLocaleString()) : v;
  return (
    <div className="report-print">
      <PageHeader title={r?.title ?? all.find((a) => a.key === reportKey)?.title ?? 'Report'} breadcrumb={<Link to="/admin/reports" className="hover:text-ink print:hidden">Reports</Link>}
        description={r ? `${r.period} · ${r.description}` : undefined}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          <Select aria-label="Report" value={reportKey} onChange={(e) => nav(`/admin/reports/${e.target.value}`)} className="w-auto">{all.map((a) => <option key={a.key} value={a.key}>{a.title}</option>)}</Select>
          {can('reports.export') && <>
            <Button variant="outline" size="sm" loading={busy === 'csv'} onClick={() => exp('csv')}><FileText />CSV</Button>
            <Button variant="outline" size="sm" loading={busy === 'xlsx'} onClick={() => exp('xlsx')}><FileSpreadsheet />Excel</Button>
            <Button variant="outline" size="sm" loading={busy === 'pdf'} onClick={() => exp('pdf')}><Download />PDF</Button>
          </>}
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Print</Button>
        </div>} />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4 print:hidden">
        <div className="flex flex-wrap gap-1 rounded-btn bg-canvas p-1" role="group" aria-label="Period">
          {PRESETS.map(([k, l, days]) => <button key={k} type="button" aria-pressed={range.preset === k} onClick={() => setRange({ preset: k, from: days ? iso(new Date(Date.now() - days * 86400000)) : '2000-01-01', to: iso(new Date()) })}
            className={cn('rounded px-3 py-1.5 text-sm', range.preset === k ? 'bg-surface font-medium text-primary shadow-sm' : 'text-ink-muted hover:text-ink')}>{l}</button>)}
        </div>
        <Field label="From">{(id) => <Input id={id} type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, preset: 'custom', from: e.target.value })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={range.to} min={range.from} max={iso(new Date())} onChange={(e) => setRange({ ...range, preset: 'custom', to: e.target.value })} />}</Field>
      </Card>
      {!r ? <Skeleton className="h-96 rounded-card" /> : (
        <div className="space-y-5">
          {r.suppressed && <Alert tone="info">Groups with fewer than 3 people are combined into “Other” because your role cannot view alumni records.</Alert>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {r.summary.map((s) => <Card key={s.label} className="p-4"><p className="font-heading text-2xl font-semibold tabular-nums text-ink">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p><p className="mt-1 text-xs text-ink-muted">{s.label}</p></Card>)}
          </div>
          <Card><CardHeader title="Chart" description={r.chart.series.length === 1 ? r.chart.series[0]!.name : undefined} /><div className="p-5"><Chart data={r.chart} /></div></Card>
          <Card>
            <CardHeader title="Data" description={r.notes} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line bg-canvas/60 text-xs uppercase tracking-wide text-ink-muted">{r.columns.map((c) => <th key={c.key} scope="col" className={cn('px-4 py-2.5 font-medium', c.type ? 'text-end' : 'text-start')}>{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {r.rows.length === 0 ? <tr><td colSpan={r.columns.length} className="px-4 py-8 text-center text-ink-muted">No data for this period.</td></tr>
                    : r.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={cn('px-4 py-2', r.columns[j]?.type ? 'text-end tabular-nums' : 'text-ink')}>{cell(v, r.columns[j]?.type)}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

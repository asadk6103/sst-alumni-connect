import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, MailCheck, School, UserPlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { yearsRange, type PublicBatch, type RegistrationPolicy } from '@/lib/alumni';
import { COUNTRIES } from '@/lib/countries';
import { useSite } from '@/lib/site';
import { cn } from '@/lib/utils';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, PasswordInput, Select } from '@/components/ui/form';
import { PasswordChecklist, passwordRules } from './pages';
import { useT } from '@/lib/i18n';
import { CustomFieldsForm, customErrors, useCustomFields, type CustomValues } from '@/components/customFields';

const STEPS = [
  { key: 'account', label: 'Account' },
  { key: 'school', label: 'SST details' },
  { key: 'present', label: 'Today' },
] as const;
const FIELD_STEP: Record<string, number> = {
  full_name: 0, email: 0, phone: 0, password: 0, kind: 1, admission_year: 1, graduation_year: 1, batch_id: 1, class_name: 1,
  registration_no: 1, gender: 1, date_of_birth: 1, city: 2, country: 2, designation: 2, organization: 2, accept_terms: 2,
};

type Form = {
  full_name: string; email: string; phone: string; password: string; confirm: string; kind: 'alumni' | 'student';
  admission_year: string; graduation_year: string; batch_id: string; class_name: string; registration_no: string; gender: string;
  date_of_birth: string; city: string; country: string; designation: string; organization: string; accept_terms: boolean;
};

export function RegisterPage() {
  const site = useSite();
  const t = useT();
  const extraDefs = useCustomFields('alumni_profile', { registration: true });
  const [extra, setExtra] = useState<CustomValues>({});
  const policy = useQuery({ queryKey: ['public-batches'], queryFn: () => api<{ data: PublicBatch[]; meta: RegistrationPolicy }>('/api/v1/public/batches', { auth: false }) });
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>({
    full_name: '', email: '', phone: '', password: '', confirm: '', kind: 'alumni', admission_year: '', graduation_year: '', batch_id: '',
    class_name: '', registration_no: '', gender: '', date_of_birth: '', city: '', country: 'Pakistan', designation: '', organization: '',
    accept_terms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const p = policy.data?.meta;
  const thisYear = new Date().getFullYear();
  const gradYears = useMemo(() => f.kind === 'student' ? yearsRange(thisYear, thisYear + 12).reverse() : yearsRange(p?.founding_year ?? 1985, thisYear), [f.kind, p, thisYear]);
  const admYears = yearsRange(p?.founding_year ?? 1985, thisYear);
  const batches = (policy.data?.data ?? []).filter((b) => String(b.graduation_year) === f.graduation_year);
  const pwOk = passwordRules(site.auth).every((r) => r.test(f.password)) && f.password === f.confirm;

  const stepValid = [
    f.full_name.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && (!p?.require_phone || f.phone.trim().length >= 7) && pwOk,
    !!f.graduation_year && (!p?.require_registration_no || !!f.registration_no.trim()) && (!p?.require_admission_year || !!f.admission_year),
    !!f.city.trim() && !!f.country.trim() && f.accept_terms,
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step < 2) {
      if (stepValid[step]) setStep(step + 1);
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    const num = (v: string) => (v ? Number(v) : null);
    const opt = (v: string) => v.trim() || null;
    try {
      const r = await api<{ data: { message: string } }>('/api/v1/auth/register', {
        method: 'POST', auth: false, body: {
          full_name: f.full_name, email: f.email, phone: opt(f.phone), password: f.password, kind: f.kind,
          admission_year: num(f.admission_year), graduation_year: num(f.graduation_year), batch_id: f.batch_id || null,
          class_name: opt(f.class_name), registration_no: opt(f.registration_no), gender: f.gender || null,
          date_of_birth: f.date_of_birth || null, city: opt(f.city), country: opt(f.country), designation: opt(f.designation),
          organization: opt(f.organization), accept_terms: f.accept_terms, custom_fields: extra,
        },
      });
      setDone(r.data.message);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fields;
        setErrors(fields);
        const first = Object.keys(fields)[0];
        if (first && FIELD_STEP[first] !== undefined) setStep(FIELD_STEP[first]!);
        else if (first?.startsWith('custom_fields.')) setStep(2);
        setError(err.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title="Registration received" footer={<Link to="/login" className="font-medium text-primary hover:underline">Go to sign in</Link>}>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success"><MailCheck className="h-7 w-7" /></span>
          <p className="mt-4 text-sm text-ink">{done}</p>
          <p className="mt-3 text-sm text-ink-muted">The alumni office then verifies that you studied at {site.institution_name}. You can sign in and complete your profile in the meantime.</p>
        </div>
      </AuthLayout>
    );
  }
  if (policy.isLoading) return <AuthLayout title="Join the alumni network" wide><Skeleton className="h-80" /></AuthLayout>;
  if (p && !p.registration_open) {
    return (
      <AuthLayout title="Registration is closed" footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
        <Alert tone="info">New registrations are not being accepted right now. Please contact the alumni office{site.contact_email ? <> at <a className="text-primary underline" href={`mailto:${site.contact_email}`}>{site.contact_email}</a></> : ''}.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide title={t('auth.register_title', 'Join the alumni network')} subtitle={`Create your account to reconnect with the ${site.institution_name} community.`}
      footer={<>{t('auth.have_account', 'Already registered?')} <Link to="/login" className="font-medium text-primary hover:underline">{t('auth.sign_in', 'Sign in')}</Link></>}>
      <ol className="mb-6 flex items-center gap-2" aria-label="Registration steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
              i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-white' : 'bg-canvas text-ink-muted')} aria-current={i === step ? 'step' : undefined}>
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn('hidden text-sm sm:block', i === step ? 'font-medium text-ink' : 'text-ink-muted')}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.full_name} className="sm:col-span-2">
              {(id) => <Input id={id} autoComplete="name" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus />}
            </Field>
            <Field label="Email address" required error={errors.email}>
              {(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} />}
            </Field>
            <Field label="Mobile number" required={p?.require_phone} error={errors.phone} hint="Used to verify your account; private by default.">
              {(id, d) => <Input id={id} aria-describedby={d} type="tel" autoComplete="tel" placeholder="+92 300 1234567" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}
            </Field>
            <Field label="Password" required error={errors.password}>
              {(id) => (<><PasswordInput id={id} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
                <PasswordChecklist password={f.password} /></>)}
            </Field>
            <Field label="Confirm password" required error={f.confirm && f.confirm !== f.password ? 'Passwords do not match.' : undefined}>
              {(id) => <PasswordInput id={id} autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} />}
            </Field>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {p?.allow_students && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-[13px] font-medium text-ink">I am</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([['alumni', 'A former student', GraduationCap], ['student', 'A current student', School]] as const).map(([k, l, Icon]) => (
                    <button key={k} type="button" onClick={() => { set('kind', k); set('graduation_year', ''); set('batch_id', ''); }} aria-pressed={f.kind === k}
                      className={cn('flex items-center gap-2 rounded-btn border px-3 py-2.5 text-sm', f.kind === k ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line text-ink hover:bg-canvas')}>
                      <Icon className="h-4 w-4" />{l}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <Field label="Admission year" required={p?.require_admission_year} error={errors.admission_year}>
              {(id) => <Select id={id} value={f.admission_year} onChange={(e) => set('admission_year', e.target.value)}>
                <option value="">Select…</option>{admYears.map((y) => <option key={y}>{y}</option>)}</Select>}
            </Field>
            <Field label={f.kind === 'student' ? 'Expected graduation year' : 'Graduation year'} required error={errors.graduation_year}>
              {(id) => <Select id={id} value={f.graduation_year} onChange={(e) => { set('graduation_year', e.target.value); set('batch_id', ''); }}>
                <option value="">Select…</option>{gradYears.map((y) => <option key={y}>{y}</option>)}</Select>}
            </Field>
            <Field label="Batch" error={errors.batch_id} hint={f.graduation_year && !batches.length ? 'The alumni office will assign your batch.' : undefined}>
              {(id, d) => <Select id={id} aria-describedby={d} value={f.batch_id} disabled={!batches.length} onChange={(e) => set('batch_id', e.target.value)}>
                <option value="">{batches.length ? 'Select…' : '—'}</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
            </Field>
            <Field label="Class / section" error={errors.class_name}>
              {(id) => <Input id={id} placeholder="e.g. Matric – Science" value={f.class_name} onChange={(e) => set('class_name', e.target.value)} />}
            </Field>
            <Field label="Student registration number" required={p?.require_registration_no} error={errors.registration_no}
              hint="Speeds up verification against school records." className="sm:col-span-2">
              {(id, d) => <Input id={id} aria-describedby={d} value={f.registration_no} onChange={(e) => set('registration_no', e.target.value)} />}
            </Field>
            <Field label="Gender" error={errors.gender}>
              {(id) => <Select id={id} value={f.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>}
            </Field>
            <Field label="Date of birth" error={errors.date_of_birth} hint="Private by default.">
              {(id, d) => <Input id={id} aria-describedby={d} type="date" max={new Date().toISOString().slice(0, 10)} value={f.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} />}
            </Field>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current city" required error={errors.city}>
              {(id) => <Input id={id} autoComplete="address-level2" value={f.city} onChange={(e) => set('city', e.target.value)} />}
            </Field>
            <Field label="Current country" required error={errors.country}>
              {(id) => (<><Input id={id} list="countries" autoComplete="country-name" value={f.country} onChange={(e) => set('country', e.target.value)} />
                <datalist id="countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist></>)}
            </Field>
            <Field label={f.kind === 'student' ? 'Occupation (optional)' : 'Current occupation'} error={errors.designation}>
              {(id) => <Input id={id} placeholder="e.g. Software Engineer" value={f.designation} onChange={(e) => set('designation', e.target.value)} />}
            </Field>
            <Field label="Current organisation" error={errors.organization}>
              {(id) => <Input id={id} autoComplete="organization" value={f.organization} onChange={(e) => set('organization', e.target.value)} />}
            </Field>
            {!!extraDefs.data?.length && (
              <div className="border-t border-line pt-4 sm:col-span-2">
                <CustomFieldsForm defs={extraDefs.data} value={extra} onChange={setExtra} errors={customErrors(errors)} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Checkbox checked={f.accept_terms} onCheckedChange={(v) => set('accept_terms', v)}
                label={<>I confirm these details are correct and accept the {p?.terms_url
                  ? <a href={p.terms_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">terms and privacy policy</a>
                  : 'terms and privacy policy'}.</>} />
              {errors.accept_terms && <p className="mt-1 text-xs text-danger">{errors.accept_terms}</p>}
            </div>
            <Alert tone="info" className="sm:col-span-2">Your contact details and date of birth stay private until you choose to share them.</Alert>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-2">
          {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep(step - 1)}><ArrowLeft />Back</Button> : <span />}
          {step < 2
            ? <Button type="submit" disabled={!stepValid[step]}>Continue<ArrowRight /></Button>
            : <Button type="submit" loading={busy} disabled={!stepValid[2]}><UserPlus />Create account</Button>}
        </div>
      </form>
    </AuthLayout>
  );
}

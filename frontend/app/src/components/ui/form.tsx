import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-btn border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-canvas disabled:text-ink-muted ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, 'h-10', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-[96px] py-2 leading-relaxed', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(control, 'h-10 pr-8', className)} {...p} />
));
Select.displayName = 'Select';

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={cn('pr-10', props.className)} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-muted hover:text-ink">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, hint, error, required, children, className, htmlFor }: {
  label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: (id: string, describedBy?: string) => ReactNode;
  className?: string; htmlFor?: string;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const msgId = `${id}-msg`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} className="text-xs text-danger">{error}</p> : hint ? <p id={msgId} className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; id?: string;
}) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={sid} className="cursor-pointer">
          {label && <span className="block text-sm font-medium text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
        </label>
      )}
      <SwitchPrimitive.Root id={sid} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
        className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-line transition-colors data-[state=checked]:bg-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </SwitchPrimitive.Root>
    </div>
  );
}

export function Checkbox({ checked, onCheckedChange, label, id, disabled }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; label?: ReactNode; id?: string; disabled?: boolean;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex items-center gap-2">
      <CheckboxPrimitive.Root id={cid} checked={checked} disabled={disabled} onCheckedChange={(v) => onCheckedChange(v === true)}
        className="grid h-4 w-4 shrink-0 place-items-center rounded border border-line bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
        <CheckboxPrimitive.Indicator><Check className="h-3 w-3 text-white" strokeWidth={3} /></CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <label htmlFor={cid} className="cursor-pointer text-sm text-ink">{label}</label>}
    </div>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const id = useId();
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-btn border border-line bg-surface p-1" />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!valid} maxLength={7}
          className="font-mono uppercase" />
      </div>
    </div>
  );
}

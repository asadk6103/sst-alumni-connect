import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

// ── Dialog ──────────────────────────────────────────────────────────────────
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode;
  footer?: ReactNode; wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-dark/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface shadow-pop focus:outline-none', wide ? 'max-w-2xl' : 'max-w-md')}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="font-heading text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">{description}</DialogPrimitive.Description>
                : <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ConfirmOpts = { title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

// ── Toasts ──────────────────────────────────────────────────────────────────
type Toast = { id: number; tone: 'success' | 'error'; message: string };
const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => undefined);
export const useToast = () => {
  const push = useContext(ToastContext);
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m) };
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };
  return (
    <ToastContext.Provider value={push}>
      <ConfirmContext.Provider value={ask}>
        {children}
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink shadow-pop">
              {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <span className="min-w-0 flex-1">{t.message}</span>
              <button className="text-ink-muted hover:text-ink" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <Dialog open={!!confirm} onOpenChange={(v) => !v && close(false)} title={confirm?.title ?? ''} description={confirm?.description}
          footer={<>
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{confirm?.confirmLabel ?? 'Confirm'}</Button>
          </>} />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

// ── Dropdown menu ───────────────────────────────────────────────────────────
export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn('z-50 min-w-[200px] rounded-card border border-line bg-surface p-1 shadow-pop', className)}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}
export function MenuItem({ children, onSelect, danger }: { children: ReactNode; onSelect?: () => void; danger?: boolean }) {
  return (
    <DropdownPrimitive.Item onSelect={onSelect} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-canvas [&_svg]:h-4 [&_svg]:w-4', danger ? 'text-danger' : 'text-ink')}>
      {children}
    </DropdownPrimitive.Item>
  );
}
export const MenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DropdownPrimitive.Label className="px-2.5 py-1.5 text-xs text-ink-muted">{children}</DropdownPrimitive.Label>;

// ── Tabs (underline style, as in the profile design) ────────────────────────
export function Tabs({ value, onValueChange, tabs, children }: {
  value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger key={t.value} value={t.value}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-ink-muted hover:text-ink data-[state=active]:border-primary data-[state=active]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}
export const TabPanel = ({ value, children }: { value: string; children: ReactNode }) => (
  <TabsPrimitive.Content value={value} className="pt-5 focus-visible:outline-none">{children}</TabsPrimitive.Content>
);

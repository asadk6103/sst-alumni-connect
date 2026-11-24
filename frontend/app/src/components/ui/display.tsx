import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { AlertTriangle, CheckCircle2, Info, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-card', className)} {...p} />;
}

export function CardHeader({ title, icon: Icon, action, description, className }: {
  title: ReactNode; icon?: ComponentType<{ className?: string }>; action?: ReactNode; description?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
        <div className="min-w-0">
          <h2 className="font-heading text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-canvas text-ink-muted border-line',
  primary: 'bg-primary-soft text-primary border-primary/15',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-[#9a6a00] border-warning/25',
  danger: 'bg-danger/10 text-danger border-danger/20',
  navy: 'bg-navy text-white border-navy',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: keyof typeof badgeTones; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium', badgeTones[tone], className)}>{children}</span>;
}

export function Avatar({ name, src, size = 36, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn('inline-flex shrink-0 overflow-hidden rounded-full bg-primary-soft align-middle', className)}
      style={{ width: size, height: size }}>
      {src && <AvatarPrimitive.Image src={src} alt="" className="h-full w-full object-cover" />}
      <AvatarPrimitive.Fallback className="grid h-full w-full place-items-center font-semibold text-primary" style={{ fontSize: size * 0.38 }}>
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  return (
    <ProgressPrimitive.Root value={value} aria-label={label} className={cn('relative h-2 overflow-hidden rounded-full bg-primary-soft', className)}>
      <ProgressPrimitive.Indicator className="h-full rounded-full bg-primary transition-transform duration-500"
        style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }} />
    </ProgressPrimitive.Root>
  );
}

/** Statistic tile as in the dashboard design: icon bubble, figure, label, optional trend. */
export function StatTile({ icon: Icon, value, label, trend, tone = 'primary' }: {
  icon: ComponentType<{ className?: string }>; value: ReactNode; label: string; trend?: { value: string; up: boolean } | null;
  tone?: 'primary' | 'success' | 'navy' | 'warning';
}) {
  const tones = { primary: 'bg-primary-soft text-primary', success: 'bg-success/10 text-success', navy: 'bg-navy/10 text-navy', warning: 'bg-warning/10 text-warning' };
  return (
    <Card className="flex items-center gap-4 p-5">
      <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-full', tones[tone])}><Icon className="h-7 w-7" /></span>
      <div className="min-w-0">
        <p className="font-heading text-2xl font-semibold leading-tight text-ink">{value}</p>
        <p className="truncate text-sm text-ink-muted">{label}</p>
        {trend && (
          <p className={cn('mt-0.5 flex items-center gap-1 text-xs font-medium', trend.up ? 'text-success' : 'text-danger')}>
            {trend.up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{trend.value}
          </p>
        )}
      </div>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('relative overflow-hidden rounded-md bg-line/60 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent', className)} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: ComponentType<{ className?: string }>; title: string; description?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary"><Icon className="h-7 w-7" /></span>
      <p className="mt-4 font-heading text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const alertTones = {
  info: { cls: 'border-primary/20 bg-primary-soft/60 text-ink', icon: Info, iconCls: 'text-primary' },
  success: { cls: 'border-success/25 bg-success/5 text-ink', icon: CheckCircle2, iconCls: 'text-success' },
  warning: { cls: 'border-warning/30 bg-warning/5 text-ink', icon: AlertTriangle, iconCls: 'text-warning' },
  danger: { cls: 'border-danger/25 bg-danger/5 text-ink', icon: XCircle, iconCls: 'text-danger' },
};

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertTones; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = alertTones[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-card border px-4 py-3 text-sm', t.cls, className)}>
      <t.icon className={cn('mt-0.5 h-4 w-4 shrink-0', t.iconCls)} />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink-muted')}>{children}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-xs text-ink-muted">{breadcrumb}</div>}
        <h1 className="font-heading text-[22px] font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary', className)} />;
}

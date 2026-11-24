import { GraduationCap } from 'lucide-react';
import { pickVariant, useSite } from '@/lib/site';
import { cn } from '@/lib/utils';

/** Institution logo (uploaded in the setup wizard / branding) with the institution name. */
export function BrandMark({ light, size = 44, showName = true, className }: { light?: boolean; size?: number; showName?: boolean; className?: string }) {
  const site = useSite();
  const logo = (light ? site.assets.logo_light : undefined) ?? site.assets.institution_logo;
  // "SST Public School Rashidabad" → "SST Public School" / "Rashidabad" (as in the design)
  const words = site.institution_name.trim().split(/\s+/);
  const line1 = words.length >= 3 ? words.slice(0, -1).join(' ') : site.institution_name;
  const line2 = words.length >= 3 ? words.at(-1)! : '';
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      {logo ? (
        <img src={pickVariant(logo, size * 2)} alt={logo.alt || `${site.institution_name} logo`} style={{ height: size, width: 'auto' }}
          className="shrink-0 object-contain" />
      ) : (
        <span className={cn('grid shrink-0 place-items-center rounded-lg', light ? 'bg-white/10 text-white' : 'bg-primary-soft text-primary')}
          style={{ width: size, height: size }} aria-hidden>
          <GraduationCap style={{ width: size * 0.55, height: size * 0.55 }} />
        </span>
      )}
      {showName && (
        <span className={cn('min-w-0 font-heading font-semibold leading-tight', light ? 'text-white' : 'text-ink')}>
          <span className="block truncate text-[15px]">{line1}</span>
          {line2 && <span className="block truncate text-[15px]">{line2}</span>}
        </span>
      )}
    </span>
  );
}

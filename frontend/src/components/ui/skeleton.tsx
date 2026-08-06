import { cn } from '../../lib/utils';

// Skeleton loader that reserves layout space to prevent layout shift.
// `inverse` renders a light fill for use on dark (bg-ink) surfaces.
export function Skeleton({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn('skeleton', inverse ? 'bg-white/10' : 'bg-muted/70', className)}
    />
  );
}

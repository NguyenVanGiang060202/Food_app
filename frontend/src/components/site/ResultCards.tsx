import { MapPin, Star, Clock } from 'lucide-react';
import type { Dish, Restaurant } from '@/lib/food-data';
import { Link } from 'react-router-dom';
import { SaveRestaurantButton } from './SaveRestaurantButton';
import { SmartImage } from './SmartImage';

const vnd = (n: number) => (n > 0 ? `${Math.round(n / 1000)}k₫` : null);

export function DishResult({ id, dish }: { id: string; dish?: Dish }) {
  if (!dish) return null;
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className="group flex gap-3 rounded-xl border border-border bg-card p-2 transition-colors hover:border-primary/50"
    >
      <SmartImage
        src={dish.image}
        alt={dish.name}
        className="h-16 w-16 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 py-0.5">
        <div className="truncate font-display text-base leading-tight">{dish.name}</div>
        <div className="truncate text-xs text-muted-foreground">{dish.vi}</div>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {vnd(dish.price) && (
            <span className="font-medium text-foreground">{vnd(dish.price)}</span>
          )}
          {dish.rating > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-mustard text-mustard" />
              {dish.rating}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function RestaurantResult({
  id,
  matching,
  matchingNames,
  explanation,
  restaurant,
  onSelect,
  compact = false,
}: {
  id: string;
  matching?: string[];
  matchingNames?: string[];
  explanation?: string | null;
  restaurant: Restaurant;
  onSelect?: () => void;
  compact?: boolean;
}) {
  const r = restaurant;
  const matchedNames = (matchingNames ?? matching ?? []).filter(Boolean).slice(0, 2);
  if (compact) {
    const selectOnly = Boolean(onSelect);
    return (
      <article
        onClick={onSelect}
        onKeyDown={(event) => {
          if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onSelect();
          }
        }}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        className={`relative flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-soft transition-colors hover:border-primary/50 ${onSelect ? 'cursor-pointer' : ''}`}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-stretch gap-3">
          {selectOnly ? (
            <button
              type="button"
              aria-label={`Hiển thị ${r.name} trên bản đồ`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.();
              }}
              className="block aspect-square w-full self-start overflow-hidden rounded-lg bg-muted text-left"
            >
              <SmartImage
                src={r.image}
                alt={r.image ? r.name : 'Chưa có ảnh'}
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <Link
              to={`/restaurants/${r.id}`}
              onClick={(event) => event.stopPropagation()}
              className="block aspect-square w-full self-start overflow-hidden rounded-lg bg-muted"
            >
              <SmartImage
                src={r.image}
                alt={r.image ? r.name : 'Chưa có ảnh'}
                className="h-full w-full object-cover"
              />
            </Link>
          )}
          <div className="min-w-0 py-0.5">
            <div className="flex min-w-0 items-start gap-2">
              {selectOnly ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.();
                  }}
                  className="min-w-0 flex-1 text-left font-display text-base leading-tight hover:text-primary"
                >
                  <span className="line-clamp-2">{r.name}</span>
                </button>
              ) : (
                <Link
                  to={`/restaurants/${r.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="min-w-0 flex-1 font-display text-base leading-tight hover:text-primary"
                >
                  <span className="line-clamp-2">{r.name}</span>
                </Link>
              )}
              <div className="shrink-0">
                <SaveRestaurantButton restaurantId={r.id} size="compact" />
              </div>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {r.distanceKm != null ? `${r.distanceKm}km · ` : ''}
                {r.area}
              </span>
              {r.rating != null && r.rating > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <Star className="h-3 w-3 fill-mustard text-mustard" />
                  {r.rating}
                </span>
              )}
              {r.hours && (
                <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
                  <Clock className="h-3 w-3 shrink-0" />
                  {r.hours}
                </span>
              )}
            </div>
            {matchedNames.length > 0 && (
              <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                Có: {matchedNames.join(', ')}
              </div>
            )}
            {explanation && (
              <div className="mt-1 line-clamp-3 text-[11px] leading-4 text-primary/80">
                {explanation}
              </div>
            )}
            {selectOnly && (
              <div className="mt-2 inline-flex w-fit items-center rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                Nhấn để xem trên bản đồ
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 border-t border-border/60 pt-3">
          <Link
            to={`/restaurants/${r.id}`}
            onClick={(event) => event.stopPropagation()}
            className="block w-full truncate rounded-full bg-foreground px-3 py-1.5 text-center text-xs font-medium text-background hover:opacity-90"
          >
            Xem chi tiết
          </Link>
        </div>
      </article>
    );
  }
  return (
    <div
      onClick={onSelect}
      className={`relative flex h-full min-h-[212px] flex-col rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 ${onSelect ? 'cursor-pointer' : ''}`}
    >
      <div className="flex min-h-0 flex-1 gap-3">
        <Link
          to={`/restaurants/${r.id}`}
          onClick={(event) => event.stopPropagation()}
          className="flex min-w-0 flex-1 gap-3 pr-10"
        >
          {r.image ? (
            <img
              src={r.image}
              alt={r.name}
              loading="lazy"
              className={`${compact ? 'h-14 w-14' : 'h-16 w-16'} shrink-0 rounded-lg object-cover`}
            />
          ) : (
            <img
              src="/no-photo.svg"
              alt="Chưa có ảnh"
              className={`${compact ? 'h-14 w-14' : 'h-16 w-16'} shrink-0 rounded-lg object-cover`}
            />
          )}
          <div className="min-w-0 py-0.5">
            <div className="line-clamp-2 font-display text-base leading-tight">{r.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" />
                {r.distanceKm != null ? `${r.distanceKm}km · ` : ''}
                {r.area}
              </span>
              {r.rating != null && r.rating > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-mustard text-mustard" />
                  {r.rating}
                  {r.reviews != null && r.reviews > 0 && (
                    <span className="text-muted-foreground/70">({r.reviews.toLocaleString()})</span>
                  )}
                </span>
              )}
              <span className="inline-flex items-center gap-0.5">
                {r.hours && (
                  <>
                    <Clock className="h-3 w-3" />
                    {r.hours}
                  </>
                )}
              </span>
            </div>
            {matchedNames.length > 0 && (
              <div className="mt-1 truncate text-xs text-muted-foreground">
                Có: {matchedNames.join(', ')}
              </div>
            )}
            {explanation && (
              <div className="mt-1 line-clamp-2 text-xs text-primary/80">{explanation}</div>
            )}
          </div>
        </Link>
        <div className="absolute right-3 top-3 z-10">
          <SaveRestaurantButton restaurantId={r.id} size="compact" />
        </div>
      </div>
      <div className="ml-[76px] mt-auto flex min-h-8 flex-wrap items-center gap-2 pt-3">
        {onSelect && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
          >
            Xem trên bản đồ
          </button>
        )}
        <Link
          to={`/restaurants/${r.id}`}
          onClick={(event) => event.stopPropagation()}
          className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          Xem chi tiết
        </Link>
        {!compact && r.sourceUrl && (
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-xs text-primary hover:underline"
          >
            Google Maps ↗
          </a>
        )}
      </div>
    </div>
  );
}

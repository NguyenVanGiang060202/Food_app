import { Star, MapPin, Clock } from "lucide-react";
import type { Dish, Restaurant } from "@/lib/food-data";
import { formatVnd } from "@/lib/food-data";
import { Link } from "react-router-dom";
import { SaveRestaurantButton } from "./SaveRestaurantButton";
import { Skeleton } from "../ui/skeleton";

// Mirrors RestaurantCard layout (image aspect + text + footer) so it reserves
// the same height and prevents layout shift while restaurant data loads.
export function RestaurantCardSkeleton() {
  return (
    <div aria-hidden className="flex h-full flex-col rounded-2xl bg-card p-3 shadow-soft">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-stretch gap-4">
        <div className="aspect-square w-full self-start overflow-hidden rounded-xl bg-muted" />
        <div className="min-w-0 py-1">
          <div className="flex min-w-0 items-start gap-2">
            <Skeleton className="h-5 w-3/4 rounded-md" />
            <div className="shrink-0"><Skeleton className="h-5 w-5 rounded-full" /></div>
          </div>
          <Skeleton className="mt-2 h-3 w-1/2 rounded-md" />
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            <Skeleton className="h-3 w-10 rounded-md" />
            <Skeleton className="h-3 w-14 rounded-md" />
          </div>
          <Skeleton className="mt-3 h-3 w-full rounded-md" />
          <Skeleton className="mt-1.5 h-3 w-2/3 rounded-md" />
        </div>
      </div>
      <div className="mt-4 border-t border-border/60 pt-3">
        <Skeleton className="h-8 w-full rounded-full" />
      </div>
    </div>
  );
}

export function DishCard({ dish, size = "md" }: { dish: Dish; size?: "sm" | "md" | "lg" }) {
  return (
    <Link
      to={`/dishes/${encodeURIComponent(dish.id)}`}
      className="group block overflow-hidden rounded-2xl bg-card shadow-soft pressable transition-all hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className={`relative overflow-hidden ${size === "lg" ? "aspect-[4/5]" : "aspect-[4/3]"}`}>
        <img
          src={dish.image}
          alt={dish.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        {dish.rating > 0 && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm">
            <Star className="h-3 w-3 fill-primary text-primary" />
            {dish.rating}
          </div>
        )}
      </div>
      <div className="p-4">
        {(dish.cuisine || dish.category) && (
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            {dish.cuisine && <span>{dish.cuisine}</span>}
            {dish.cuisine && dish.category && <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />}
            {dish.category && <span>{dish.category}</span>}
          </div>
        )}
        <h3 className="mt-1.5 font-display text-lg leading-tight">{dish.name}</h3>
        {dish.vi && <p className="text-sm text-muted-foreground">{dish.vi}</p>}
        <div className="mt-3 flex items-center justify-between">
          {dish.price > 0 && <span className="text-sm font-medium">{formatVnd(dish.price)}</span>}
          <div className="flex flex-wrap gap-1">
            {dish.attrs.slice(0, 2).map((a) => (
              <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {a}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function RestaurantCard({ r, compact = false, dense = false, saved }: { r: Restaurant; compact?: boolean; dense?: boolean; saved?: boolean }) {
  if (dense) {
    return (
      <article className="group flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-card p-2 shadow-soft pressable transition-all hover:-translate-y-0.5 hover:shadow-lift">
        <Link to={`/restaurants/${r.id}`} className="block aspect-[2.5/1] shrink-0 overflow-hidden rounded-lg bg-muted">
          {r.image ? <img src={r.image} alt={r.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <img src="/no-photo.svg" alt="Chưa có ảnh" className="h-full w-full object-cover" />}
        </Link>
        <div className="flex min-h-0 flex-1 flex-col px-0.5 py-2">
          <div className="flex min-w-0 items-start gap-1.5">
            <Link to={`/restaurants/${r.id}`} className="min-w-0 flex-1 font-display text-sm leading-tight hover:text-primary"><span className="line-clamp-1">{r.name}</span></Link>
            <SaveRestaurantButton restaurantId={r.id} size="compact" initialSaved={saved} />
          </div>
          {r.cuisine.length > 0 && <div className="mt-1 truncate text-[9px] uppercase tracking-wider text-muted-foreground">{r.cuisine.slice(0, 2).join(" · ")}</div>}
          <div className="mt-1 flex min-w-0 items-center gap-2 truncate text-[10px] text-muted-foreground">
            {r.rating != null && r.rating > 0 && <span><Star className="mr-0.5 inline h-2.5 w-2.5 fill-primary text-primary" />{r.rating}</span>}
            {r.area && <span className="truncate">{r.area}</span>}
          </div>
          <Link to={`/restaurants/${r.id}`} className="mt-2 block truncate rounded-full bg-foreground px-2 py-1.5 text-center text-[10px] font-medium text-background hover:opacity-90">Xem chi tiết</Link>
        </div>
      </article>
    );
  }
  return (
    <article className={`group flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-soft pressable transition-all hover:-translate-y-0.5 hover:shadow-lift ${compact ? "p-2.5" : "p-3"}`}>
      <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-stretch ${compact ? "gap-2.5" : "gap-4"}`}>
        <Link to={`/restaurants/${r.id}`} className={`block aspect-square w-full self-start overflow-hidden rounded-xl bg-muted ${compact ? "rounded-lg" : ""}`}>
          {r.image ? <img src={r.image} alt={r.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" /> : <img src="/no-photo.svg" alt="Chưa có ảnh" className="h-full w-full object-cover" />}
        </Link>
        <div className={`min-w-0 ${compact ? "py-0.5" : "py-1"}`}>
          <div className={`flex min-w-0 items-start ${compact ? "gap-1.5" : "gap-2"}`}>
            <Link to={`/restaurants/${r.id}`} className={`min-w-0 flex-1 font-display leading-tight hover:text-primary ${compact ? "text-base" : "text-lg"}`}>
              <span className="line-clamp-2">{r.name}</span>
            </Link>
            <div className="shrink-0"><SaveRestaurantButton restaurantId={r.id} size="compact" initialSaved={saved} /></div>
          </div>
          {r.cuisine.length > 0 && <div className={`mt-1 flex items-center gap-2 uppercase tracking-widest text-muted-foreground ${compact ? "text-[10px]" : "text-[11px]"}`}>{r.cuisine.slice(0, 2).join(" · ")}</div>}
          {(r.rating != null && r.rating > 0) || (r.reviews != null && r.reviews > 0) || r.distanceKm != null ? (
            <div className={`flex flex-wrap items-center text-muted-foreground ${compact ? "mt-1 gap-x-2 gap-y-0.5 text-[11px]" : "mt-2 gap-x-3 gap-y-1 text-xs"}`}>
              {(r.rating != null && r.rating > 0) || (r.reviews != null && r.reviews > 0) ? <span className="inline-flex items-center gap-1">{r.rating != null && r.rating > 0 && <><Star className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} fill-primary text-primary`} />{r.rating}</>}{r.reviews != null && r.reviews > 0 && <span className="text-muted-foreground/70">({r.reviews.toLocaleString()})</span>}</span> : null}
              {r.distanceKm != null && <span className="inline-flex items-center gap-1"><MapPin className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />{r.distanceKm} km</span>}
            </div>
          ) : null}
          {r.area && <p className={`mt-1 line-clamp-2 text-muted-foreground ${compact ? "text-[11px] leading-4" : "text-xs"}`}>{r.area}</p>}
          {r.hours && <span className={`mt-1.5 inline-flex items-center gap-1.5 text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}><Clock className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />{r.hours}</span>}
        </div>
      </div>
      <div className={`border-t border-border/60 ${compact ? "mt-2.5 pt-2" : "mt-4 pt-3"}`}>
        <Link to={`/restaurants/${r.id}`} className={`block w-full truncate rounded-full bg-foreground text-center font-medium text-background hover:opacity-90 ${compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-xs"}`}>Xem chi tiết</Link>
      </div>
    </article>
  );
}

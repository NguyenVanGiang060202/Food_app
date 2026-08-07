import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Clock, MapPin, SlidersHorizontal, Star, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Header } from '@/components/site/Header';
import { MapCanvas } from '@/components/site/MapCanvas';
import { SmartImage } from '@/components/site/SmartImage';
import type { Restaurant } from '@/lib/food-data';
import { listRestaurants } from '@/lib/api';
import { attrLabel, distanceOptions, filterGroups } from '@/lib/taste-filters';
import { SaveRestaurantButton } from '@/components/site/SaveRestaurantButton';

export function MapPage() {
  const [attrs, setAttrs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedFilters, setExpandedFilters] = useState(false);
  const [openGroup, setOpenGroup] = useState('feel');
  const [maxDistance, setMaxDistance] = useState<number>(5);
  const [openNow, setOpenNow] = useState(false);
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [items, setItems] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<'map' | 'list'>('map');
  const locationEpochRef = useRef(0);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError(true);
      setLoading(false);
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation([position.coords.latitude, position.coords.longitude]);
        setLocationBusy(false);
      },
      () => {
        setLocationBusy(false);
        setLocationError(true);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!location) {
      setItems([]);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    const radii = maxDistance === 5 ? [5, 8, 10] : [maxDistance];
    const loadNearby = async () => {
      for (const radius of radii) {
        const result = await listRestaurants({
          limit: 40,
          latitude: location[0],
          longitude: location[1],
          radiusMeters: radius * 1000,
          openNow: openNow || undefined,
          sort: 'distance',
          tastes: attrs.filter((attr) => attr !== 'gần đây'),
        });
        if (result.length >= 8 || radius === radii[radii.length - 1]) return result;
      }
      return [];
    };
    void loadNearby()
      .then((result) => {
        if (!cancelled) {
          setItems(result.slice(0, 20));
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attrs, location, maxDistance, openNow, reloadKey]);

  const toggle = (value: string) =>
    setAttrs((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  const locate = () => {
    if (locationBusy) return;
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    const epoch = locationEpochRef.current;
    setLocationBusy(true);
    setLocationError(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (locationEpochRef.current === epoch)
          setLocation([position.coords.latitude, position.coords.longitude]);
        setLocationBusy(false);
      },
      () => {
        setLocationBusy(false);
        setLocationError(true);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const reset = () => {
    locationEpochRef.current += 1;
    setAttrs([]);
    setMaxDistance(5);
    setOpenNow(false);
    setLocation(null);
    setLocationError(false);
  };
  const activeCount = attrs.length + (maxDistance ? 1 : 0) + (openNow ? 1 : 0);

  const visibleGroups = expandedFilters ? filterGroups : filterGroups.slice(0, 2);
  const quickFilters = [
    { label: 'Ấm bụng', attrs: ['nóng'] },
    { label: 'Nhẹ bụng', attrs: ['ăn nhẹ', 'nhẹ bụng'] },
    { label: 'Sát bên', attrs: [], maxDistance: 2 },
  ];
  return (
    <div className="h-screen overflow-hidden">
      <Header />
      <main className="container-page flex h-[calc(100vh-4rem)] min-h-0 flex-col py-4 pb-20 md:pb-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[.18em] text-primary">
              BẢN ĐỒ KÈO ĂN
            </div>
            <h1 className="mt-2 font-display text-3xl md:text-4xl">Quán quanh bạn</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading ? 'Bếp đang dò quanh khu của bạn…' : `${items.length} quán đang chờ chốt`}
            </p>
          </div>
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-soft"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Bộ lọc
            {activeCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-white">
                {activeCount}
              </span>
            )}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-border bg-card p-1 lg:hidden">
          <button
            type="button"
            onClick={() => setView('map')}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${view === 'map' ? 'bg-primary text-white' : 'text-muted-foreground'}`}
          >
            Bản đồ
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${view === 'list' ? 'bg-primary text-white' : 'text-muted-foreground'}`}
          >
            Danh sách
          </button>
        </div>
        {showFilters && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-3 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Lọc theo nhu cầu</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Chỉ mở thêm nhóm khi bạn cần tinh chỉnh.
                </p>
              </div>
              {activeCount > 0 && (
                <button
                  onClick={reset}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Đặt lại
                </button>
              )}
            </div>
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              <button
                onClick={locate}
                disabled={locationBusy}
                className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-60"
              >
                {locationBusy ? 'Đang định vị…' : location ? 'Đã lấy vị trí' : 'Dùng vị trí'}
              </button>
              {quickFilters.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setAttrs(preset.attrs);
                    if (preset.maxDistance !== undefined) setMaxDistance(preset.maxDistance);
                    if (preset.maxDistance) locate();
                  }}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {visibleGroups.map((group) => {
                const selected = group.options.filter((option) =>
                  attrs.includes(option.value),
                ).length;
                const isOpen = openGroup === group.key;
                return (
                  <div key={group.key} className="rounded-xl border border-border/70">
                    <button
                      onClick={() => setOpenGroup(isOpen ? '' : group.key)}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-medium"
                    >
                      <span>
                        {group.title}
                        {selected > 0 && (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {selected}
                          </span>
                        )}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 pb-3 pt-2">
                        {group.options.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => toggle(option.value)}
                            className={`rounded-full border px-3 py-1.5 text-xs ${attrs.includes(option.value) ? 'border-primary bg-primary text-white' : 'border-border'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {filterGroups.length > 2 && (
              <button
                onClick={() => setExpandedFilters((value) => !value)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {expandedFilters
                  ? 'Thu gọn khẩu vị'
                  : `Xem thêm ${filterGroups.length - 2} nhóm khẩu vị`}
              </button>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
              {distanceOptions.map((item) => (
                <button
                  key={item.value}
                  onClick={() => {
                    const next = maxDistance === item.value ? 5 : (item.value ?? 5);
                    setMaxDistance(next);
                    locate();
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs ${maxDistance === item.value ? 'border-primary bg-primary text-white' : 'border-border'}`}
                >
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => setOpenNow((value) => !value)}
                className={`rounded-full border px-3 py-1.5 text-xs ${openNow ? 'border-primary bg-primary text-white' : 'border-border'}`}
              >
                Đang mở
              </button>
            </div>
            {activeCount > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {attrs.map((attr) => (
                  <button
                    key={attr}
                    onClick={() => toggle(attr)}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary"
                  >
                    {attrLabel(attr)}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <button
                  onClick={() => setMaxDistance(5)}
                  className="rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary"
                >
                  {maxDistance}km <X className="ml-1 inline h-3 w-3" />
                </button>
                {openNow && (
                  <button
                    onClick={() => setOpenNow(false)}
                    className="rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary"
                  >
                    Đang mở <X className="ml-1 inline h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            {locationError && (
              <span className="mt-2 block text-xs text-destructive">
                Không thể lấy vị trí. Kiểm tra quyền trình duyệt.
              </span>
            )}
          </div>
        )}
        <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_1.1fr]">
          <div
            className={`min-h-0 space-y-2 overflow-y-auto pr-1 ${view === 'list' ? 'block' : 'hidden'} lg:block`}
          >
            {loadError && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                <p>Không thể tải dữ liệu từ backend.</p>
                <button
                  onClick={() => setReloadKey((value) => value + 1)}
                  className="mt-3 rounded-full bg-foreground px-4 py-2 text-sm text-background"
                >
                  Thử lại
                </button>
              </div>
            )}
            {loading && (
              <div className="rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">
                {locationBusy ? 'Đang lấy vị trí…' : 'Đang tải quán…'}
              </div>
            )}
            {!location && !loading && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                <p>Cho phép vị trí để xem các quán trong bán kính 5km.</p>
                <button
                  onClick={locate}
                  className="mt-3 rounded-full bg-foreground px-4 py-2 text-sm text-background"
                >
                  Dùng vị trí
                </button>
              </div>
            )}
            {items.map((restaurant) => (
              <article
                key={restaurant.id}
                onClick={() => setActive(restaurant.id)}
                onMouseEnter={() => setActive(restaurant.id)}
                onMouseLeave={() => setActive(null)}
                className={`group cursor-pointer overflow-hidden rounded-xl border bg-card shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift ${active === restaurant.id ? 'border-primary ring-2 ring-primary/10' : 'border-border'}`}
              >
                <div className="flex gap-2.5 p-2.5">
                  <Link
                    to={`/restaurants/${restaurant.id}`}
                    className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg"
                  >
                    {restaurant.image ? (
                      <SmartImage
                        src={restaurant.image}
                        alt={restaurant.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <img
                        src="/no-photo.svg"
                        alt="Chưa có ảnh"
                        className="h-full w-full object-cover"
                      />
                    )}{' '}
                    {restaurant.rating != null && restaurant.rating > 0 && (
                      <span className="absolute bottom-1 left-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                        <Star className="mr-0.5 inline h-2.5 w-2.5 fill-primary text-primary" />
                        {restaurant.rating}
                      </span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[9px] uppercase tracking-[.14em] text-muted-foreground">
                          {restaurant.cuisine.slice(0, 2).join(' · ')}
                        </div>
                        <Link
                          to={`/restaurants/${restaurant.id}`}
                          className="mt-0.5 block truncate font-display text-base hover:text-primary"
                        >
                          {restaurant.name}
                        </Link>
                      </div>
                      <SaveRestaurantButton restaurantId={restaurant.id} size="compact" />
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-x-2 truncate text-[11px] text-muted-foreground">
                      {restaurant.distanceKm != null && (
                        <span className="shrink-0">
                          <MapPin className="mr-0.5 inline h-2.5 w-2.5" />
                          {restaurant.distanceKm}km
                        </span>
                      )}
                      {restaurant.rating != null && restaurant.rating > 0 && (
                        <span className="shrink-0">
                          <Star className="mr-0.5 inline h-2.5 w-2.5 fill-primary text-primary" />
                          {restaurant.rating}
                        </span>
                      )}
                      <span className="truncate">{restaurant.area}</span>
                    </div>
                    {restaurant.sourceUrl && (
                      <a
                        href={restaurant.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-primary hover:underline"
                      >
                        Mở trong Google Maps <ArrowUpRight className="h-3 w-3 shrink-0" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!loading && !loadError && location && items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Không có quán nào khớp bộ lọc trong bán kính {maxDistance}km.
              </div>
            )}
          </div>
          <div
            className={`relative min-h-0 overflow-hidden rounded-2xl border border-border bg-parchment shadow-soft ${view === 'map' ? 'block' : 'hidden'} lg:block`}
          >
            <MapCanvas
              activeId={active}
              restaurants={items}
              userLocation={location}
              onHover={setActive}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Link, RouterProvider, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  MapPin,
  MessageCircle,
  Phone,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Header } from './components/site/Header';
import { Footer } from './components/site/Footer';
import { RestaurantCard, RestaurantCardSkeleton } from './components/site/cards';
import { SaveRestaurantButton } from './components/site/SaveRestaurantButton';
import { SmartImage } from './components/site/SmartImage';
import { type Restaurant, formatVnd } from './lib/food-data';
import {
  detailToRestaurant,
  getPreferences,
  getRestaurant,
  listCategories,
  listRestaurants,
  listSavedRestaurantsPage,
  searchRestaurants,
  signOut,
  updatePreferences,
  type BackendCategory,
  type BackendRestaurantDetail,
  type UserPreferences,
} from './lib/api';
import { AskPage } from './pages/AskPage';
import { useAuth } from './hooks/useAuth';
import { Reveal, Stagger, StaggerItem } from './lib/motion';

const SourceMapPage = lazy(() =>
  import('./pages/MapPage').then(({ MapPage }) => ({ default: MapPage })),
);
const AuthPage = lazy(() =>
  import('./pages/AuthPage').then(({ AuthPage }) => ({ default: AuthPage })),
);

function DiscoverPage() {
  const [catalog, setCatalog] = useState<Restaurant[]>([]);
  const [categories, setCategories] = useState<BackendCategory[]>([]);
  const [busy, setBusy] = useState(true);
  const railRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const updateCanScroll = () => {
    const el = railRef.current;
    if (!el) return;
    setCanScroll(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    setCanScrollBack(el.scrollLeft > 4);
  };
  const scrollRail = (direction: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  useEffect(() => {
    setCanScroll(false);
    const el = railRef.current;
    if (el) updateCanScroll();
    window.addEventListener('resize', updateCanScroll);
    return () => window.removeEventListener('resize', updateCanScroll);
  }, [busy]);
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listRestaurants({ limit: 12, sort: 'rating' }), listCategories()])
      .then(([restaurantsResult, categoriesResult]) => {
        if (cancelled) return;
        setCatalog(restaurantsResult.status === 'fulfilled' ? restaurantsResult.value : []);
        setCategories(categoriesResult.status === 'fulfilled' ? categoriesResult.value : []);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <section className="container-page pt-10 md:pt-14">
        <Reveal>
          <h1 className="mt-2 max-w-2xl text-balance font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">
            Dạo món trước khi <em className="italic text-primary">chốt kèo</em>.
          </h1>
        </Reveal>
      </section>
      <section className="container-page py-16">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Quán đang thơm
              </div>
              <h2 className="mt-2 font-display text-3xl md:text-4xl">Được thực khách khen nhiều</h2>
            </div>
            <div className="hidden gap-2 sm:flex">
              <button
                type="button"
                aria-label="Quán trước"
                onClick={() => scrollRail(-1)}
                className="rounded-full border border-border bg-card p-2 transition-colors hover:bg-muted active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Quán tiếp theo"
                onClick={() => scrollRail(1)}
                className="rounded-full border border-border bg-card p-2 transition-colors hover:bg-muted active:scale-95"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Reveal>
        <div className="relative">
          <div
            ref={railRef}
            onScroll={updateCanScroll}
            className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-none"
          >
            {busy
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-full shrink-0 snap-start w-[calc(50%-0.5rem)] md:w-[calc(33.333%-0.67rem)] lg:w-[calc(25%-0.75rem)]"
                  >
                    <RestaurantCardSkeleton />
                  </div>
                ))
              : catalog.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    className="h-full shrink-0 snap-start w-[calc(50%-0.5rem)] md:w-[calc(33.333%-0.67rem)] lg:w-[calc(25%-0.75rem)]"
                  >
                    <RestaurantCard r={restaurant} />
                  </div>
                ))}
          </div>
          {canScrollBack && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex w-24 items-center justify-start bg-gradient-to-r from-background to-transparent">
              <button
                type="button"
                aria-label="Quán trước"
                onClick={() => scrollRail(-1)}
                className="pointer-events-auto ml-1 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          )}
          {canScroll && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-24 items-center justify-end bg-gradient-to-l from-background to-transparent">
              <button
                type="button"
                aria-label="Quán tiếp theo"
                onClick={() => scrollRail(1)}
                className="pointer-events-auto mr-1 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {!busy && catalog.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">Bếp chưa có quán để dọn ra.</p>
        )}
      </section>
      <section className="container-page py-16">
        <Reveal>
          <div className="rounded-3xl border border-primary/15 bg-primary/5 p-7 md:p-10">
            <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
                  <CalendarDays className="h-4 w-4" /> Gợi ý theo mùa
                </div>
                <h2 className="mt-2 font-display text-3xl">Cuối tuần này ăn gì?</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  Hỏi Bếp về brunch, món ngày mưa, đồ uống mùa hè hoặc bất kỳ cảm hứng theo mùa nào
                  bạn đang nghĩ tới.
                </p>
              </div>
              <Link
                to={`/?prompt=${encodeURIComponent('Gợi ý những địa điểm phù hợp cho cuối tuần này, gần tôi.')}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90"
              >
                Gợi ý cho tôi <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
      <section className="container-page py-16">
        <Reveal>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Chọn theo cảm hứng
          </div>
          <h2 className="mt-2 font-display text-3xl">
            Không biết gọi gì? Bắt đầu từ một cảm giác.
          </h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: 'Nóng và có nước',
                text: 'Phở, bún, mì và những món ấm bụng.',
                query: 'món nóng có nước',
              },
              {
                title: 'Ăn nhẹ buổi chiều',
                text: 'Một món vừa đủ, không quá nặng bụng.',
                query: 'ăn nhẹ',
              },
              {
                title: 'Cay cho tỉnh táo',
                text: 'Đậm vị hơn cho ngày cần năng lượng.',
                query: 'món cay',
              },
              {
                title: 'Bữa trưa chắc bụng',
                text: 'Gợi ý nhanh cho một bữa ăn tử tế.',
                query: 'bữa trưa',
              },
            ].map((mood) => (
              <Link
                key={mood.title}
                to={`/?prompt=${encodeURIComponent(mood.query)}`}
                className="rounded-2xl border border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lift"
              >
                <div className="font-display text-xl">{mood.title}</div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{mood.text}</p>
                <span className="mt-5 inline-block text-xs font-medium text-primary">
                  Hỏi Bếp →
                </span>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>
      <section className="bg-ink text-background">
        <div className="container-page py-16">
          <Reveal>
            <div className="grid gap-10 md:grid-cols-[1fr,2fr]">
              <div>
                <div className="text-xs uppercase tracking-widest text-mustard">Theo ẩm thực</div>
                <h2 className="mt-2 font-display text-3xl">
                  Một thế giới bàn ăn,
                  <br />
                  xếp theo gian bếp.
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {categories.slice(0, 12).map((category) => (
                  <Link
                    key={category.slug}
                    to={`/?prompt=${encodeURIComponent(`Gợi ý những nhà hàng ${category.name} ngon và được đánh giá cao gần tôi.`)}`}
                    aria-label={`Hỏi Bếp về nhóm ${category.name}`}
                    className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20 hover:bg-white/10"
                  >
                    <div className="font-display text-xl">{category.name}</div>
                    <span className="mt-4 inline-block text-xs text-mustard opacity-0 transition-opacity group-hover:opacity-100">
                      Hỏi Bếp →
                    </span>
                  </Link>
                ))}
                {!busy && categories.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-background/70">
                    Bếp chưa có nhóm ẩm thực để phân mâm.
                  </div>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </section>
      <Footer />
    </>
  );
}

function ExplorePage() {
  const [trending, setTrending] = useState<Restaurant[]>([]);
  useEffect(() => {
    void listRestaurants({ limit: 6, sort: 'rating' })
      .then(setTrending)
      .catch(() => setTrending([]));
  }, []);
  return (
    <main className="container-page pb-24">
      <section className="relative overflow-hidden rounded-b-[2.5rem] bg-ink px-6 py-14 text-background md:px-12 md:py-20">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.2em] text-mustard">
            <Sparkles className="h-4 w-4" /> Dạo món theo cảm hứng
          </div>
          <h1 className="mt-5 font-display text-5xl leading-[.98] md:text-7xl">
            Hôm nay bạn muốn <em className="italic text-primary">ăn gì?</em>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-background/70">
            Không cần biết tên món. Chọn một cảm giác, một dịp, hoặc một gian bếp; Bếp sẽ tìm phần
            còn lại cho bạn.
          </p>
          <Link
            to="/"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
          >
            <MessageCircle className="h-4 w-4" /> Hỏi Bếp điều bạn đang thèm
          </Link>
        </div>
      </section>
      <section className="pt-16">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading
            eyebrow="Đang được chú ý"
            title="Quán nổi bật"
            text="Những địa điểm đang được thực khách để ý nhiều hơn."
          />
          <Link
            to="/"
            className="mb-1 hidden shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline sm:inline-flex"
          >
            Hỏi Bếp để tìm thêm <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <Stagger className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trending.map((restaurant) => (
            <StaggerItem key={restaurant.id}>
              <RestaurantCard r={restaurant} />
            </StaggerItem>
          ))}
          {trending.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
              Các quán nổi bật đang được cập nhật.
            </div>
          )}
        </Stagger>
      </section>
      <section className="mt-16 rounded-3xl border border-primary/15 bg-primary/5 p-7 md:p-10">
        <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
              <CalendarDays className="h-4 w-4" /> Gợi ý theo mùa
            </div>
            <h2 className="mt-2 font-display text-3xl">Cuối tuần này ăn gì?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Hỏi Bếp về brunch, món ngày mưa, đồ uống mùa hè hoặc bất kỳ cảm hứng theo mùa nào bạn
              đang nghĩ tới.
            </p>
          </div>
          <Link
            to={`/?prompt=${encodeURIComponent('Gợi ý những địa điểm phù hợp cho cuối tuần này, gần tôi.')}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90"
          >
            Gợi ý cho tôi <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function SavedPage() {
  const { user, loading } = useAuth();
  const [saved, setSaved] = useState<Restaurant[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    setBusy(true);
    void listSavedRestaurantsPage({ limit: 15 })
      .then((page) => setSaved(page.data))
      .catch(() => setSaved([]))
      .finally(() => setBusy(false));
  }, [user]);
  if (loading) return null;
  if (!user)
    return (
      <main className="container-page min-h-[70vh] py-16">
        <h1 className="font-display text-4xl">Cất quán cần có sổ gu</h1>
        <p className="mt-3 text-muted-foreground">Vào Bếp để lưu lại những quán muốn thử.</p>
        <Link
          className="mt-5 inline-block rounded-full bg-primary px-5 py-3 text-sm font-medium text-white"
          to="/auth?returnTo=/saved"
        >
          Vào Bếp
        </Link>
      </main>
    );
  return (
    <main className="container-page min-h-[70vh] py-10">
      <div className="text-xs font-bold uppercase tracking-[.18em] text-primary">
        SỔ QUÁN CỦA BẠN
      </div>
      <h1 className="mt-2 font-display text-4xl">Quán đã cất</h1>
      {busy ? (
        <p className="mt-8 text-sm text-muted-foreground">Bếp đang mở sổ quán...</p>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {saved.map((restaurant) => (
            <RestaurantCard key={restaurant.id} r={restaurant} />
          ))}
        </div>
      )}
      {!busy && saved.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          Sổ quán còn trống. Đi dạo món rồi cất vài quán nhé.
        </p>
      )}
    </main>
  );
}

function RestaurantDetailPage() {
  const id = useLocation().pathname.split('/').filter(Boolean).pop() ?? '';
  const [detail, setDetail] = useState<BackendRestaurantDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showAllReviews, setShowAllReviews] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    setLightboxIndex(null);
    setShowAllReviews(false);
    void getRestaurant(id)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setLightboxIndex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  if (failed)
    return (
      <main className="container-page py-20">
        <p className="text-muted-foreground">Không thể tải thông tin quán.</p>
        <Link to="/discover" className="mt-4 inline-block text-primary hover:underline">
          Quay lại dạo món
        </Link>
      </main>
    );
  if (!detail)
    return (
      <main className="container-page py-20">
        <p className="text-muted-foreground">Đang tải thông tin quán...</p>
      </main>
    );
  const restaurant = detailToRestaurant(detail);
  return (
    <main className="container-page py-10 pb-24 md:pb-16">
      <Link to="/discover" className="text-sm text-muted-foreground hover:text-foreground">
        Quay lại dạo món
      </Link>
      <div className="mt-6 grid gap-8 md:grid-cols-[1.1fr,1fr]">
        <SmartImage
          src={restaurant.image}
          alt={restaurant.image ? restaurant.name : 'Chưa có ảnh'}
          className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift"
        />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {restaurant.cuisine.join(' · ')}
          </div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1 className="font-display text-4xl md:text-5xl">{restaurant.name}</h1>
            <SaveRestaurantButton restaurantId={restaurant.id} size="large" />
          </div>
          <div className="mt-4 text-sm text-muted-foreground">{restaurant.area}</div>
          {restaurant.description && (
            <p className="mt-6 text-muted-foreground">{restaurant.description}</p>
          )}
          <div className="mt-6">
            <a
              href={restaurant.sourceUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex rounded-full border border-border px-4 py-2 text-sm ${restaurant.sourceUrl ? 'hover:border-primary hover:text-primary' : 'pointer-events-none text-muted-foreground'}`}
            >
              {restaurant.sourceUrl ? 'Mở trong Google Maps' : 'Nguồn Google Maps chưa rõ'}
            </a>
          </div>
        </div>
      </div>
      {(restaurant.hours || detail.phone || detail.websiteUrl) && (
        <section className="mt-10 rounded-2xl border border-border bg-card p-5 md:p-6">
          <h2 className="font-display text-2xl">Thông tin quán</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {restaurant.hours && (
              <InfoItem icon={Clock} label="Giờ mở cửa" value={restaurant.hours} />
            )}
            {detail.phone && (
              <InfoItem
                icon={Phone}
                label="Điện thoại"
                value={detail.phone}
                href={`tel:${detail.phone.replace(/[^+\d]/g, '')}`}
              />
            )}
            {detail.websiteUrl && (
              <InfoItem
                icon={Globe}
                label="Website"
                value={detail.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                href={detail.websiteUrl}
              />
            )}
          </div>
        </section>
      )}
      {detail.images.length > 1 && (
        <section className="mt-10">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-2xl">Thư viện ảnh</h2>
            {detail.images.length > 4 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(0)}
                className="text-sm text-primary hover:underline"
              >
                Xem cả {detail.images.length} ảnh
              </button>
            )}
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {detail.images.slice(0, 3).map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setLightboxIndex(index)}
                className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl"
              >
                <SmartImage
                  src={image.url}
                  alt={image.altText ?? restaurant.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                />
              </button>
            ))}
            {detail.images.length > 3 && (
              <button
                type="button"
                onClick={() => setLightboxIndex(3)}
                aria-label={`Xem thêm ${detail.images.length - 3} ảnh`}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted"
              >
                <SmartImage
                  src={detail.images[3].url}
                  alt=""
                  className="h-full w-full scale-110 object-cover opacity-60 blur-[2px]"
                />
                <span className="absolute inset-0 grid place-items-center bg-black/25 text-sm font-semibold text-white">
                  +{detail.images.length - 3} ảnh
                </span>
              </button>
            )}
          </div>
        </section>
      )}
      {detail.dishes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Món nổi bật</h2>
          <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {[...detail.dishes]
              .sort((a, b) => Number(b.isPopular) - Number(a.isPopular))
              .slice(0, 12)
              .map((dish) => (
                <li
                  key={dish.id}
                  className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-3"
                >
                  <span className="text-sm font-medium">
                    {dish.isPopular && (
                      <span
                        aria-hidden="true"
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                      />
                    )}
                    {dish.name}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {dish.priceAmount != null ? formatVnd(dish.priceAmount) : '—'}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {detail.reviews.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Thực khách nói gì</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="flex items-center gap-1 text-sm font-semibold">
              {restaurant.rating ?? '—'}
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </span>
            <span className="text-sm text-muted-foreground">
              {restaurant.reviews ?? 0} đánh giá
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(showAllReviews ? detail.reviews : detail.reviews.slice(0, 6)).map((review) => (
              <div
                key={review.id}
                className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={`h-3.5 w-3.5 ${(review.rating ?? 0) > index ? 'fill-amber-400 text-amber-400' : 'text-muted/30'}`}
                    />
                  ))}
                  {review.rating != null && (
                    <span className="ml-2 text-sm font-medium text-muted-foreground">
                      {review.rating}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-foreground">
                  {review.content ?? 'Không có nhận xét viết.'}
                </p>
              </div>
            ))}
          </div>
          {detail.reviews.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllReviews((value) => !value)}
              className="mt-4 inline-flex items-center gap-1 rounded-full border border-border px-4 py-2 text-sm hover:border-primary hover:text-primary"
            >
              {showAllReviews
                ? 'Thu gọn đánh giá'
                : `Xem thêm ${detail.reviews.length - 6} đánh giá`}
            </button>
          )}
        </section>
      )}
      <AnimatePresence>
        {lightboxIndex != null && detail.images[lightboxIndex] && (
          <motion.div
            className="fixed inset-0 z-[1200] flex flex-col bg-black/95 pb-[env(safe-area-inset-bottom)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <span className="text-sm tabular-nums text-white/80">
                {lightboxIndex + 1} / {detail.images.length}
              </span>
              <button
                type="button"
                aria-label="Đóng ảnh"
                onClick={() => setLightboxIndex(null)}
                className="grid h-10 w-10 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.img
                  key={detail.images[lightboxIndex].id}
                  src={detail.images[lightboxIndex].url}
                  alt={detail.images[lightboxIndex].altText ?? restaurant.name}
                  className="absolute inset-0 h-full w-full object-contain p-4"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
              </AnimatePresence>
              {lightboxIndex > 0 && (
                <button
                  type="button"
                  aria-label="Ảnh trước"
                  onClick={() => setLightboxIndex((index) => (index ?? 0) - 1)}
                  className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              {lightboxIndex < detail.images.length - 1 && (
                <button
                  type="button"
                  aria-label="Ảnh tiếp theo"
                  onClick={() => setLightboxIndex((index) => (index ?? 0) + 1)}
                  className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-center gap-2 py-4">
              {detail.images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={`Xem ảnh ${index + 1}`}
                  onClick={() => setLightboxIndex(index)}
                  className={`h-1.5 rounded-full transition-all ${
                    index === lightboxIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/30'
                  }`}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-sm font-medium">{value}</div>
      </div>
    </>
  );
  const layout = 'flex items-start gap-3';
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${layout} hover:text-primary`}>
      {body}
    </a>
  ) : (
    <div className={layout}>{body}</div>
  );
}

function ProfilePage() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>({
    favoriteCategorySlugs: [],
    dietaryPreferences: [],
    preferredPriceLevels: [],
    aiPreferences: {
      favoriteFoodSlugs: [],
      favoriteCuisineSlugs: [],
      tastePreferences: [],
      dietaryPreferences: [],
      diningStyles: [],
      restaurantFeatures: [],
      memories: [],
    },
  });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!user) return;
    void getPreferences()
      .then(setPreferences)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [user]);
  if (!user)
    return (
      <main className="container-page py-20">
        <h1 className="font-display text-4xl">Bạn chưa vào Bếp</h1>
        <Link className="mt-5 inline-block text-primary" to="/auth">
          Vào Bếp
        </Link>
      </main>
    );
  const save = async () => {
    const saved = await updatePreferences(preferences);
    setPreferences(saved);
    setNotice('Đã lưu sổ gu. Bếp sẽ nhớ kỹ hơn khi gợi ý món.');
  };
  return (
    <main className="container-page min-h-[70vh] py-10 pb-24 md:py-14">
      <div className="max-w-3xl">
        <div className="text-xs font-bold uppercase tracking-[.18em] text-primary">GU RUỘT</div>
        <h1 className="mt-3 font-display text-5xl leading-tight">Dạy Bếp hiểu bạn hơn.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Mỗi lựa chọn giúp Hỏi Bếp gợi ý tự nhiên hơn, ngắn hơn và đúng gu hơn.
        </p>
        <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-soft">
          <h2 className="font-display text-2xl">Tài khoản</h2>
          <p className="mt-2 text-sm text-muted-foreground">{user.displayName || user.email}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white"
            >
              Lưu sổ gu
            </button>
            <button
              onClick={() => {
                void signOut().finally(() => {
                  window.location.href = '/';
                });
              }}
              className="rounded-full border border-border px-5 py-2 text-sm"
            >
              Đăng xuất
            </button>
          </div>
          {notice && <p className="mt-4 text-sm text-primary">{notice}</p>}
        </section>
      </div>
    </main>
  );
}

function SearchPage() {
  const query = new URLSearchParams(useLocation().search).get('q') ?? '';
  const [items, setItems] = useState<Restaurant[]>([]);
  useEffect(() => {
    void searchRestaurants(query)
      .then(setItems)
      .catch(() => setItems([]));
  }, [query]);
  return (
    <main className="container-page py-12 pb-24">
      <h1 className="font-display text-4xl">Tìm kiếm</h1>
      <p className="mt-2 text-muted-foreground">Kết quả thật cho "{query}"</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {items.map((restaurant) => (
          <RestaurantCard key={restaurant.id} r={restaurant} />
        ))}
      </div>
      {items.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">Không tìm thấy quán phù hợp.</p>
      )}
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[.18em] text-primary">{eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl md:text-4xl">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
function NotFound() {
  return (
    <main className="container-page py-20">
      <h1 className="font-display text-4xl">Không tìm thấy trang</h1>
      <Link className="mt-5 inline-block text-primary" to="/">
        Về bàn chính
      </Link>
    </main>
  );
}

const router = createBrowserRouter([
  {
    path: '/auth',
    element: (
      <Suspense
        fallback={
          <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
            Đang tải...
          </main>
        }
      >
        <AuthPage />
      </Suspense>
    ),
  },
  { path: '/', element: <AskPage /> },
  {
    path: '/discover',
    element: (
      <>
        <Header />
        <DiscoverPage />
      </>
    ),
  },
  {
    path: '/map',
    element: (
      <Suspense
        fallback={
          <main className="container-page py-20 text-sm text-muted-foreground">
            Đang tải bản đồ...
          </main>
        }
      >
        <SourceMapPage />
      </Suspense>
    ),
  },
  {
    path: '/saved',
    element: (
      <>
        <Header />
        <SavedPage />
        <Footer />
      </>
    ),
  },
  {
    path: '/search',
    element: (
      <>
        <Header />
        <SearchPage />
        <Footer />
      </>
    ),
  },
  {
    path: '/restaurants/:id',
    element: (
      <>
        <Header />
        <RestaurantDetailPage />
        <Footer />
      </>
    ),
  },
  {
    path: '/profile',
    element: (
      <>
        <Header />
        <ProfilePage />
        <Footer />
      </>
    ),
  },
  {
    path: '*',
    element: (
      <>
        <Header />
        <NotFound />
        <Footer />
      </>
    ),
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

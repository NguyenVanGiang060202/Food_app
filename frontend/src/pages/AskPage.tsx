import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ListFilter,
  LocateFixed,
  MessageCircle,
  RotateCcw,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Header } from '@/components/site/Header';
import { DishResult, RestaurantResult } from '@/components/site/ResultCards';
import { useLocation } from 'react-router-dom';
import type { Dish } from '@/lib/food-data';
import { attrLabel, filterGroups } from '@/lib/taste-filters';
import { MapCanvas } from '@/components/site/MapCanvas';
import {
  getRecommendations,
  interpretSearch,
  listDishes,
  toRestaurant,
  type BackendDish,
  type InterpretedSearch,
  type RecommendationItem,
} from '@/lib/api';
import { Stagger, StaggerItem } from '@/lib/motion';

type Filters = {
  attrs: string[];
  maxDistanceKm?: number;
  openNow: boolean;
  minRating?: number;
  priceLevel?: number;
};
type SearchContext = {
  keyword: string;
  filters: Filters;
  sort: 'distance' | 'rating' | 'relevance';
};
type AskTurn = { query: string; answer: string };

const suggestions = [
  'Trời lạnh, xin một tô ấm bụng',
  'Ăn nhẹ buổi chiều, ví còn 50k',
  'Cay cho tỉnh người, đừng cay đời',
  'Bữa trưa chắc bụng gần đây',
];
const quickFilters = [
  { label: 'Ấm bụng', attrs: ['nóng'], query: 'món nóng có nước' },
  { label: 'Nhẹ bụng', attrs: ['ăn nhẹ', 'nhẹ bụng'], query: 'ăn nhẹ' },
  { label: 'Ví mỏng', attrs: ['rẻ'], query: 'món ngon tiết kiệm' },
  { label: 'Gần, mở cửa', attrs: [], maxDistanceKm: 2, openNow: true, query: 'quán gần đây' },
];

export function AskPage() {
  const routeLocation = useLocation();
  const [query, setQuery] = useState('');
  const [searchContext, setSearchContext] = useState<SearchContext>({
    keyword: '',
    filters: { attrs: [], openNow: false },
    sort: 'relevance',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecommendationItem[]>([]);
  const [dishCatalog, setDishCatalog] = useState<BackendDish[]>([]);
  const [interpreted, setInterpreted] = useState<InterpretedSearch | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('bep:ask-session') ?? '[]') as AskTurn[];
    } catch {
      return [];
    }
  });
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const consumedPromptRef = useRef<string | null>(null);
  const filters = searchContext.filters;
  const submitted = turns.length > 0 || busy || result.length > 0;
  const activeCount =
    filters.attrs.length +
    (filters.maxDistanceKm ? 1 : 0) +
    (filters.openNow ? 1 : 0) +
    (filters.minRating ? 1 : 0) +
    (filters.priceLevel ? 1 : 0);
  const resultRestaurants = useMemo(
    () => result.map((item) => toRestaurant(item.restaurant)),
    [result],
  );
  const resultDishes = useMemo(() => dishCatalog.slice(0, 6).map(toAskDish), [dishCatalog]);
  const matchingDishNames = useMemo(
    () =>
      new Map(
        result.map((item) => [
          item.restaurant.id,
          dishCatalog
            .filter((dish) => dish.restaurantId === item.restaurant.id)
            .map((dish) => dish.name),
        ]),
      ),
    [dishCatalog, result],
  );

  useEffect(() => {
    sessionStorage.setItem('bep:ask-session', JSON.stringify(turns));
  }, [turns]);
  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  const locate = () => {
    if (!navigator.geolocation) return Promise.resolve(null);
    setLocationBusy(true);
    return new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setLocation(next);
          setLocationBusy(false);
          resolve(next);
        },
        () => {
          setLocationBusy(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  };

  const runSearch = async (keyword: string, nextFilters = filters) => {
    const trimmed = keyword.trim();
    if (!trimmed || busy) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setPendingQuery(trimmed);
    setInterpreted(null);
    try {
      const requestLocation = nextFilters.maxDistanceKm && !location ? await locate() : location;
      const recommendations = await getRecommendations(
        {
          query: trimmed,
          limit: 20,
          location: requestLocation ?? undefined,
          filters: {
            taste: nextFilters.attrs.length ? nextFilters.attrs : undefined,
            openNow: nextFilters.openNow || undefined,
            minRating: nextFilters.minRating,
            priceLevel: nextFilters.priceLevel,
            sort: searchContext.sort,
            ...(requestLocation && nextFilters.maxDistanceKm
              ? { radiusMeters: nextFilters.maxDistanceKm * 1000 }
              : {}),
          },
        },
        controller.signal,
      );
      const dishes = await listDishes(12, trimmed, {
        openNow: nextFilters.openNow || undefined,
      }).catch(() => []);
      const interpretation = await interpretSearch(trimmed, controller.signal).catch(() => null);
      setResult(recommendations);
      setDishCatalog(dishes);
      setInterpreted(interpretation);
      setSearchContext((current) => ({ ...current, keyword: trimmed, filters: nextFilters }));
      setTurns((current) => [
        ...current,
        {
          query: trimmed,
          answer: recommendations.length
            ? `Bếp tìm được ${recommendations.length} quán hợp cơn thèm này.`
            : 'Bếp chưa thấy quán hợp gu. Nới bộ lọc một chút nhé?',
        },
      ]);
    } catch (cause) {
      if (!controller.signal.aborted)
        setTurns((current) => [
          ...current,
          {
            query: trimmed,
            answer: cause instanceof Error ? cause.message : 'Bếp bị khét một nhịp. Thử lại nhé.',
          },
        ]);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setPendingQuery(null);
      }
    }
  };

  const incomingPrompt = new URLSearchParams(routeLocation.search).get('prompt')?.trim() ?? '';
  useEffect(() => {
    if (!incomingPrompt || consumedPromptRef.current === incomingPrompt) return;
    consumedPromptRef.current = incomingPrompt;
    void runSearch(incomingPrompt);
  }, [incomingPrompt]);

  const send = async (value = query) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuery('');
    await runSearch(trimmed, filters);
  };
  const refineSearch = (nextFilters: Filters) => {
    setSearchContext((current) => ({ ...current, filters: nextFilters }));
    if (searchContext.keyword) void runSearch(searchContext.keyword, nextFilters);
  };
  const reset = () => {
    requestRef.current?.abort();
    setQuery('');
    setResult([]);
    setDishCatalog([]);
    setInterpreted(null);
    setTurns([]);
    setPendingQuery(null);
    setActive(null);
    setSearchContext({ keyword: '', filters: { attrs: [], openNow: false }, sort: 'relevance' });
    sessionStorage.removeItem('bep:ask-session');
    textareaRef.current?.focus();
  };
  const toggleAttr = (attr: string) =>
    refineSearch({
      ...filters,
      attrs: filters.attrs.includes(attr)
        ? filters.attrs.filter((item) => item !== attr)
        : [...filters.attrs, attr],
    });

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      {!submitted ? (
        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 className="mt-5 max-w-lg text-balance font-display text-4xl leading-[1.05] md:text-6xl">
            Bụng đang <em className="italic text-primary">réo</em> món gì?
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Kể Bếp nghe một cảm giác: nóng, cay, nhẹ bụng, ví mỏng hay gần đây. Bếp sẽ dọn ra món,
            quán và lý do để bạn chốt kèo.
          </p>
          <div className="mt-8 text-[11px] uppercase tracking-widest text-muted-foreground">
            Mồi lửa cơn thèm
          </div>
          <Stagger className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((item) => (
              <StaggerItem key={item}>
                <button
                  onClick={() => void send(item)}
                  className="pressable rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground/80 hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary"
                >
                  {item}
                </button>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      ) : (
        <div className="flex-1 space-y-5 overflow-auto py-6">
          {turns.map((turn, index) => (
            <div
              key={`${turn.query}-${index}`}
              className="space-y-2 border-t border-border/60 pt-4"
            >
              <div className="ml-auto max-w-[90%] rounded-2xl bg-primary/10 px-4 py-3 text-sm">
                {turn.query}
              </div>
              <div className="text-sm leading-6">{turn.answer}</div>
              {index === turns.length - 1 && <InterpretationChips value={interpreted} />}
            </div>
          ))}
          {busy && pendingQuery && (
            <div className="space-y-3 border-t border-border/60 pt-4">
              <div className="ml-auto max-w-[90%] rounded-2xl bg-primary/10 px-4 py-3 text-sm">
                {pendingQuery}
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>Bếp đang đảo chảo dữ liệu...</span>
                <button
                  onClick={() => requestRef.current?.abort()}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary"
                >
                  Dừng bếp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="sticky bottom-16 z-30 space-y-3 bg-background pb-3 pt-2 md:bottom-0 md:pb-4">
        {showFilters && (
          <FilterPanel
            filters={filters}
            toggleAttr={toggleAttr}
            onChange={refineSearch}
            hasLocation={location !== null}
            onLocate={locate}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilters((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Khẩu vị
            {activeCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-white">
                {activeCount}
              </span>
            )}
          </button>
          <button
            onClick={locate}
            disabled={locationBusy}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${location ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`}
          >
            <LocateFixed className="h-3.5 w-3.5" />
            {locationBusy ? 'Đang định vị...' : location ? 'Đã lấy vị trí' : 'Vị trí'}
          </button>
          {filters.attrs.map((attr) => (
            <FilterChip key={attr} label={attrLabel(attr)} onRemove={() => toggleAttr(attr)} />
          ))}
          {filters.maxDistanceKm && (
            <FilterChip
              label={`Trong ${filters.maxDistanceKm}km`}
              onRemove={() => refineSearch({ ...filters, maxDistanceKm: undefined })}
            />
          )}
          {filters.openNow && (
            <FilterChip
              label="Đang mở"
              onRemove={() => refineSearch({ ...filters, openNow: false })}
            />
          )}
          {submitted && (
            <button
              type="button"
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Hỏi mẻ mới
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-lift">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
            placeholder="Bụng đang réo gì? Kể Bếp nghe..."
          />
          <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
            <span>Enter để hỏi Bếp · Shift + Enter để xuống dòng</span>
            <button
              aria-label="Hỏi Bếp"
              onClick={() => void send()}
              disabled={busy || !query.trim()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const listPane = (
    <div>
      <SearchContextChips context={searchContext} onRemove={refineSearch} />
      <div className="mb-2 mt-4 text-[11px] uppercase tracking-widest text-muted-foreground">
        Quán hợp bụng ({resultRestaurants.length})
      </div>
      {resultRestaurants.length ? (
        <Stagger className="space-y-2">
          {resultRestaurants.map((restaurant, index) => (
            <StaggerItem key={restaurant.id} onMouseEnter={() => setActive(restaurant.id)}>
              <RestaurantResult
                id={restaurant.id}
                restaurant={restaurant}
                explanation={result[index]?.explanation}
                matchingNames={matchingDishNames.get(restaurant.id)}
                onSelect={() => setActive(restaurant.id)}
                compact
              />
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Bếp chưa thấy quán hợp gu.</p>
          <p className="mt-2">
            Nới bán kính, bớt một yêu cầu khó tính hoặc hỏi Bếp theo cách khác nhé.
          </p>
        </div>
      )}
      <div className="mb-2 mt-5 text-[11px] uppercase tracking-widest text-muted-foreground">
        Món hợp gu
      </div>
      <Stagger className="space-y-2">
        {resultDishes.map((dish) => (
          <StaggerItem key={dish.id}>
            <DishResult id={dish.id} dish={dish} />
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
  const mapCanvas = (
    <MapCanvas
      restaurants={resultRestaurants}
      activeId={active}
      onHover={setActive}
      userLocation={location ? [location.latitude, location.longitude] : null}
    />
  );
  const latestAnswer = busy
    ? pendingQuery
      ? 'Bếp đang đảo chảo dữ liệu...'
      : ''
    : turns.length
      ? turns[turns.length - 1].answer
      : '';

  if (!submitted)
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="container-page flex w-full flex-1 flex-col pb-24 md:pb-6">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">{chatPane}</div>
        </main>
      </div>
    );
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex w-full flex-1 flex-col px-4 pb-24 pt-4 md:px-6 md:pb-4">
        <div className="hidden gap-4 lg:grid lg:h-[calc(100vh-6rem)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,22rem)]">
          <aside className="min-h-0 overflow-y-auto">{listPane}</aside>
          <div className="relative isolate min-h-0 overflow-hidden rounded-2xl border border-border bg-parchment">
            {mapCanvas}
          </div>
          <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card/40 p-3">
            {chatPane}
          </section>
        </div>
        <div className="relative isolate min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-parchment lg:hidden">
          {mapCanvas}
        </div>
        {!mobileChatOpen && !mobileListOpen && (
          <div className="fixed inset-x-3 bottom-24 z-[1200] flex flex-col gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileListOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-primary px-4 py-[13px] text-sm font-medium text-white shadow-lift active:scale-[0.97]"
            >
              <ListFilter className="h-4 w-4" />
              Danh sách
            </button>
            <button
              type="button"
              onClick={() => setMobileChatOpen(true)}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-card/95 p-2.5 pr-3 text-left shadow-lift backdrop-blur active:scale-[0.99]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                  {busy ? 'Bếp đang nấu...' : 'Bếp vừa trả lời'}
                </span>
                <span className="block truncate text-sm font-medium text-foreground">
                  {latestAnswer}
                </span>
              </span>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}
      </main>
      <AnimatePresence>
        {mobileListOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileListOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 z-10 flex w-[min(88vw,20rem)] flex-col bg-background shadow-2xl"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 340 }}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 p-4 pb-3">
                <div className="text-sm font-medium">
                  {resultRestaurants.length} quán · {resultDishes.length} món
                </div>
                <button
                  type="button"
                  onClick={() => setMobileListOpen(false)}
                  aria-label="Đóng danh sách"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-muted active:scale-95"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">{listPane}</div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mobileChatOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-ink/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileChatOpen(false)}
            />
            <motion.div
              className="absolute inset-x-0 bottom-0 z-10 flex h-[90vh] flex-col overflow-hidden rounded-t-[28px] border-x border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_60px_-20px_rgba(47,42,37,0.35)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            >
              <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border px-5">
                <h2 className="font-display text-[30px] font-semibold leading-none tracking-tight text-foreground">
                  Hỏi Bếp
                </h2>
                <motion.button
                  type="button"
                  whileHover={{ rotate: 8, scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setMobileChatOpen(false)}
                  aria-label="Đóng"
                  className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted active:scale-95"
                >
                  <ChevronDown className="h-5 w-5" />
                </motion.button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-6">
                {turns.map((turn, index) => (
                  <div key={`${turn.query}-${index}`} className="mb-8">
                    <motion.div
                      className="ml-auto w-fit max-w-[85%] rounded-2xl bg-secondary px-[18px] py-3 text-sm text-foreground"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      {turn.query}
                    </motion.div>
                    {index === turns.length - 1 && (
                      <motion.p
                        className="mt-4 text-sm font-medium leading-6 text-muted-foreground"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        Đã tìm thấy {resultRestaurants.length} quán — xem trên bản đồ và danh sách.
                      </motion.p>
                    )}
                    <motion.div
                      className="mt-4 text-[18px] leading-[1.7] text-foreground"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.05 }}
                    >
                      {turn.answer}
                    </motion.div>
                    {index === turns.length - 1 && (
                      <div className="mt-4">
                        <InterpretationChips value={interpreted} />
                      </div>
                    )}
                  </div>
                ))}
                {busy && pendingQuery && (
                  <div className="mb-6">
                    <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-secondary px-[18px] py-3 text-sm text-foreground">
                      {pendingQuery}
                    </div>
                    <div className="mt-4 text-sm text-muted-foreground">
                      Bếp đang đảo chảo dữ liệu...
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-border bg-background px-5 pb-4 pt-3">
                {showFilters && (
                  <div className="mb-3">
                    <FilterPanel
                      filters={filters}
                      toggleAttr={toggleAttr}
                      onChange={refineSearch}
                      hasLocation={location !== null}
                      onLocate={locate}
                    />
                  </div>
                )}
                <div className="mt-4 flex min-h-[120px] flex-col rounded-[20px] border-2 border-primary bg-card p-5 focus-within:border-primary">
                  <textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    rows={3}
                    className="w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none"
                    placeholder="Bụng đang réo gì? Kể Bếp nghe..."
                  />
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <span className="text-[11px] leading-4 text-muted-foreground">
                      Enter để hỏi Bếp · Shift + Enter để xuống dòng
                    </span>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      aria-label="Gửi"
                      onClick={() => void send()}
                      disabled={busy || !query.trim()}
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-white shadow-soft transition-opacity disabled:opacity-50"
                    >
                      {busy ? (
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      ) : (
                        <ArrowUp className="h-5 w-5" />
                      )}
                    </motion.button>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setShowFilters((value) => !value)}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground/80"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Khẩu vị
                    {activeCount > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[10px] text-white">
                        {activeCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Bắt đầu lại
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function toAskDish(item: BackendDish): Dish {
  return {
    id: item.id,
    name: item.name,
    vi: item.description ?? item.restaurantName,
    cuisine: item.restaurantName,
    category: item.category ?? 'Món ăn',
    price: item.priceAmount ?? 0,
    rating: 0,
    attrs: [],
    image: item.imageUrl ?? '/no-photo.svg',
    restaurantId: item.restaurantId,
    restaurantName: item.restaurantName,
  };
}

function SearchContextChips({
  context,
  onRemove,
}: {
  context: SearchContext;
  onRemove: (filters: Filters) => void;
}) {
  const chips: Array<{ label: string; remove: () => void }> = [];
  if (context.keyword) chips.push({ label: context.keyword, remove: () => undefined });
  context.filters.attrs.forEach((attr) =>
    chips.push({
      label: attrLabel(attr),
      remove: () =>
        onRemove({
          ...context.filters,
          attrs: context.filters.attrs.filter((value) => value !== attr),
        }),
    }),
  );
  if (context.filters.maxDistanceKm)
    chips.push({
      label: `Trong ${context.filters.maxDistanceKm} km`,
      remove: () => onRemove({ ...context.filters, maxDistanceKm: undefined }),
    });
  if (context.filters.openNow)
    chips.push({
      label: 'Đang mở',
      remove: () => onRemove({ ...context.filters, openNow: false }),
    });
  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
        Bếp đang hiểu là
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={chip.remove}
            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-background px-2.5 py-1.5 text-xs text-primary hover:border-primary"
          >
            {chip.label}
            <X className="h-3 w-3" />
          </button>
        ))}
        <span className="self-center text-[11px] text-muted-foreground">Ưu tiên: hợp câu hỏi</span>
      </div>
    </div>
  );
}

function InterpretationChips({ value }: { value: InterpretedSearch | null }) {
  if (!value) return null;
  const chips = [
    value.filters.category ? `Nhóm: ${value.filters.category}` : null,
    value.filters.district ? `Khu vực: ${value.filters.district}` : null,
    ...value.filters.attributes.map((attribute) => `Mục đích: ${attribute}`),
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Tiêu chí Bếp đã hiểu">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] text-primary"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function FilterPanel({
  filters,
  toggleAttr,
  onChange,
  hasLocation,
  onLocate,
}: {
  filters: Filters;
  toggleAttr: (value: string) => void;
  onChange: (next: Filters) => void;
  hasLocation: boolean;
  onLocate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openGroup, setOpenGroup] = useState('feel');
  const visibleGroups = expanded ? filterGroups : filterGroups.slice(0, 2);
  const applyQuick = (preset: (typeof quickFilters)[number]) =>
    onChange({
      ...filters,
      attrs: preset.attrs,
      maxDistanceKm: preset.maxDistanceKm,
      openNow: preset.openNow ?? false,
    });
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Chọn nhanh theo nhu cầu</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Không cần chọn từng khẩu vị nếu bạn chỉ muốn bắt đầu nhanh.
          </p>
        </div>
        <button
          onClick={() => onChange({ attrs: [], openNow: false })}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Đặt lại
        </button>
      </div>
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {quickFilters.map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              applyQuick(preset);
              if (preset.maxDistanceKm && !hasLocation) onLocate();
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
            filters.attrs.includes(option.value),
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
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && (
                <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 pb-3 pt-2">
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => toggleAttr(option.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs ${filters.attrs.includes(option.value) ? 'border-primary bg-primary text-white' : 'border-border'}`}
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
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-xs font-medium text-primary"
        >
          {expanded ? 'Thu gọn' : 'Thêm bộ lọc'}
        </button>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

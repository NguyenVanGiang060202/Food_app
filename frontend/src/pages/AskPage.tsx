import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LocateFixed, RotateCcw, Send, SlidersHorizontal, X } from "lucide-react";
import { Header } from "@/components/site/Header";
import { DishResult, RestaurantResult } from "@/components/site/ResultCards";
import { Link, useLocation } from "react-router-dom";
import type { Dish, Restaurant } from "@/lib/food-data";
import { attrLabel, distanceOptions, filterGroups } from "@/lib/taste-filters";
import { MapCanvas } from "@/components/site/MapCanvas";
import { getForYouRecommendations, getPreferences, getRecommendations, interpretSearch, listDishes, toRestaurant, type BackendDish, type InterpretedSearch, type RecommendationItem, type UserPreferences } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Stagger, StaggerItem } from "@/lib/motion";

type Filters = { attrs: string[]; maxDistanceKm?: number; openNow: boolean; minRating?: number; priceLevel?: number };
type SearchContext = { keyword: string; filters: Filters; sort: "distance" | "rating" | "relevance" };
type AskTurn = { role?: "user" | "system"; query: string; answer: string; result: RecommendationItem[] };
const suggestions = ["Trời lạnh, muốn gì đó nóng và có nước", "Ăn nhẹ buổi chiều, dưới 50k", "Cay xé lưỡi đi, mình đang cần tỉnh táo", "Bữa trưa chắc bụng gần đây"];
const preferenceTasteLabels: Record<string, string> = { vegetarian: "chay", vegan: "thuần chay", "low-carb": "ít tinh bột", "no-spicy": "không cay" };
const aiTasteLabels: Record<string, string> = { spicy: "cay", mild: "thanh nhẹ", sweet: "ngọt", sour: "chua", salty: "mặn", rich: "đậm đà", light: "nhẹ vị", healthy: "lành mạnh", keto: "keto", "gluten-free": "không gluten", halal: "halal" };
const quickFilters = [
  { label: "Nóng và có nước", attrs: ["nóng"], query: "món nóng có nước" },
  { label: "Ăn nhẹ", attrs: ["ăn nhẹ", "nhẹ bụng"], query: "ăn nhẹ" },
  { label: "Tiết kiệm", query: "món ngon tiết kiệm" },
  { label: "Gần và đang mở", maxDistanceKm: 2, openNow: true, query: "quán gần đây" },
];

function toTasteLabels(values: string[]): string[] {
  return [...new Set(values.map((value) => preferenceTasteLabels[value] ?? value).filter(Boolean))];
}

function toSavedTasteLabels(preferences: UserPreferences | null): string[] {
  const ai = preferences?.aiPreferences;
  return toTasteLabels([
    ...(preferences?.dietaryPreferences ?? []),
    ...(ai?.dietaryPreferences ?? []),
    ...(ai?.tastePreferences ?? []).map((value) => aiTasteLabels[value] ?? value),
    ...(ai?.favoriteFoodSlugs ?? []),
    ...(ai?.favoriteCuisineSlugs ?? []),
  ]);
}

function savedPriceLevel(preferences: UserPreferences | null): number | undefined {
  const budget = preferences?.aiPreferences?.budget;
  if (budget === "under-100") return 1;
  if (budget === "100-200") return 2;
  if (budget === "200-500") return 3;
  return preferences?.preferredPriceLevels?.[0];
}

function savedRadiusKm(preferences: UserPreferences | null): number | undefined {
  const radius = preferences?.aiPreferences?.searchRadius;
  if (radius === "2" || radius === "5" || radius === "10") return Number(radius);
  return undefined;
}

export function AskPage() {
  const routeLocation = useLocation();
  const [query, setQuery] = useState("");
  const [searchContext, setSearchContext] = useState<SearchContext>({ keyword: "", filters: { attrs: [], openNow: false }, sort: "relevance" });
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<RecommendationItem[]>([]);
  const [interpreted, setInterpreted] = useState<InterpretedSearch | null>(null);
  const { user } = useAuth();
  const [savedPreferences, setSavedPreferences] = useState<UserPreferences | null>(null);
  const [forYou, setForYou] = useState<RecommendationItem[]>([]);
  const [forYouBusy, setForYouBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [dishCatalog, setDishCatalog] = useState<BackendDish[]>([]);
  const [turns, setTurns] = useState<AskTurn[]>(() => { try { return JSON.parse(sessionStorage.getItem("bep:ask-session") ?? "[]") as AskTurn[]; } catch { return []; } });
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const forYouCarouselRef = useRef<HTMLDivElement>(null);
  const locationRequestRef = useRef<Promise<{ latitude: number; longitude: number } | null> | null>(null);
  const locationEpochRef = useRef(0);
  const consumedPromptRef = useRef<string | null>(null);
  const filters = searchContext.filters;
  const hasResults = result.length > 0;
  const activeCount = filters.attrs.length + (filters.maxDistanceKm ? 1 : 0) + (filters.openNow ? 1 : 0);
  const resultRestaurants = useMemo(() => result.map((item) => toRestaurant(item.restaurant)), [result]);
  const resultDishes = useMemo(() => {
    const recommendedIds = new Set(result.map((item) => item.restaurant.id));
    const matchingDishes = dishCatalog.filter((dish) => recommendedIds.has(dish.restaurantId));
    return (matchingDishes.length ? matchingDishes : dishCatalog).slice(0, 6).map(toAskDish);
  }, [dishCatalog, result]);
  const matchingDishNames = useMemo(() => new Map(result.map((item) => [item.restaurant.id, dishCatalog.filter((dish) => dish.restaurantId === item.restaurant.id).map((dish) => dish.name)])), [dishCatalog, result]);
  useEffect(() => { sessionStorage.setItem("bep:ask-session", JSON.stringify(turns)); }, [turns]);
  useEffect(() => { if (!user) { setSavedPreferences(null); return; } void getPreferences().then(setSavedPreferences).catch(() => setSavedPreferences(null)); }, [user]);
  const refreshForYou = () => { setForYouBusy(true); void getForYouRecommendations().then(setForYou).catch(() => setForYou([])).finally(() => setForYouBusy(false)); };
  const moveForYou = (direction: -1 | 1) => { forYouCarouselRef.current?.scrollBy({ left: direction * Math.max(240, forYouCarouselRef.current.clientWidth * 0.82), behavior: "smooth" }); };
  useEffect(() => { if (!user) { setForYou([]); return; } refreshForYou(); }, [user]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const locate = () => {
    if (locationRequestRef.current) return locationRequestRef.current;
    if (!navigator.geolocation) return Promise.resolve(null);
    const epoch = locationEpochRef.current;
    setLocationBusy(true);
    const request = new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition((position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        if (locationEpochRef.current === epoch) setLocation(next);
        setLocationBusy(false);
        resolve(next);
      }, () => {
        setLocationBusy(false);
        resolve(null);
      }, { enableHighAccuracy: true, timeout: 10000 });
    }).finally(() => { locationRequestRef.current = null; });
    locationRequestRef.current = request;
    return request;
  };
  const runSearch = async (keyword: string, nextFilters = filters, refinement = false) => { const trimmed = keyword.trim(); if (!trimmed || busy) return; requestRef.current?.abort(); setSubmitted(true); setPendingQuery(refinement ? null : trimmed); setBusy(true); setInterpreted(null); const controller = new AbortController(); requestRef.current = controller; const timeout = window.setTimeout(() => controller.abort(), 8000); try { const defaultRadiusKm = savedRadiusKm(savedPreferences); const effectiveFilters: Filters = { ...nextFilters, maxDistanceKm: nextFilters.maxDistanceKm ?? (!refinement ? defaultRadiusKm : undefined), priceLevel: nextFilters.priceLevel ?? (!refinement ? savedPriceLevel(savedPreferences) : undefined) }; const requestLocation = effectiveFilters.maxDistanceKm && !location ? await locate() : location; if (effectiveFilters.maxDistanceKm && !requestLocation) { setAnswer("Cần cho phép vị trí để lọc theo khoảng cách."); setPendingQuery(null); return; } const savedTastes = toSavedTasteLabels(savedPreferences); const recommendations = await getRecommendations({ query: trimmed, limit: 20, location: requestLocation ?? undefined, filters: { taste: toTasteLabels(effectiveFilters.attrs.length ? effectiveFilters.attrs : savedTastes), openNow: effectiveFilters.openNow || undefined, minRating: effectiveFilters.minRating, priceLevel: effectiveFilters.priceLevel, sort: searchContext.sort, ...(requestLocation && effectiveFilters.maxDistanceKm ? { radiusMeters: effectiveFilters.maxDistanceKm * 1000 } : {}) } }, controller.signal); let dishes: BackendDish[] = []; try { dishes = await listDishes(12, trimmed, { openNow: effectiveFilters.openNow || undefined }); } catch { /* Optional dish results must not block restaurant results. */ } try { setInterpreted(await interpretSearch(trimmed, controller.signal)); } catch { /* Interpretation is supplementary. */ } const nextAnswer = recommendations.length ? `Đã tìm thấy ${recommendations.length} quán — xem danh sách và bản đồ bên cạnh.` : "Không có quán nào khớp bộ lọc hiện tại. Bạn có thể mở rộng bán kính hoặc bỏ bớt bộ lọc."; setSearchContext((current) => ({ ...current, keyword: trimmed, filters: effectiveFilters })); setResult(recommendations); setDishCatalog(dishes); setAnswer(nextAnswer); setTurns((current) => refinement ? [...current, { role: "system", query: "", answer: `Đã áp dụng bộ lọc. Tìm thấy ${recommendations.length} quán phù hợp.`, result: recommendations }] : [...current, { role: "user", query: trimmed, answer: nextAnswer, result: recommendations }]); setPendingQuery(null); } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) { const errorMessage = "Dịch vụ gợi ý đang không phản hồi. Hãy kiểm tra backend/database rồi thử lại nhé."; setResult([]); setDishCatalog([]); setAnswer(errorMessage); setTurns((current) => [...current, { role: "user", query: trimmed, answer: errorMessage, result: [] }]); } setPendingQuery(null); } finally { window.clearTimeout(timeout); if (requestRef.current === controller) requestRef.current = null; setBusy(false); requestAnimationFrame(() => textareaRef.current?.focus()); } };
  const incomingPrompt = new URLSearchParams(routeLocation.search).get("prompt")?.trim() ?? "";
  useEffect(() => {
    if (!incomingPrompt || consumedPromptRef.current === incomingPrompt) return;
    consumedPromptRef.current = incomingPrompt;
    void runSearch(incomingPrompt);
  }, [incomingPrompt]);
  const send = async (value = query) => { const trimmed = value.trim(); if (!trimmed) return; const keyword = searchContext.keyword && submitted ? trimmed : trimmed; setQuery(""); await runSearch(keyword, filters, false); };
  const refineSearch = (nextFilters: Filters) => { setSearchContext((current) => ({ ...current, filters: nextFilters })); if (searchContext.keyword && submitted) void runSearch(searchContext.keyword, nextFilters, true); };
  const cancel = () => { requestRef.current?.abort(); };
  const reset = () => { requestRef.current?.abort(); locationEpochRef.current += 1; setQuery(""); setAnswer(""); setResult([]); setDishCatalog([]); setInterpreted(null); setTurns([]); setPendingQuery(null); setSubmitted(false); setActive(null); setLocation(null); setSearchContext({ keyword: "", filters: { attrs: [], openNow: false }, sort: "relevance" }); sessionStorage.removeItem("bep:ask-session"); textareaRef.current?.focus(); };
  const toggleAttr = (attr: string) => refineSearch({ ...filters, attrs: filters.attrs.includes(attr) ? filters.attrs.filter((item) => item !== attr) : [...filters.attrs, attr] });
  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      {!submitted ? (
        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 className="mt-5 max-w-lg text-balance font-display text-4xl leading-[1.05] md:text-6xl">Hôm nay bạn <em className="italic text-primary">thèm</em> gì?</h1>
          <p className="mt-4 max-w-md text-muted-foreground">Kể một cảm giác — nóng, cay, nhẹ bụng, rẻ, gần đây. Bếp sẽ chọn giúp bạn món và quán, kèm lý do.</p>
            {user && <section className="mt-8 overflow-hidden rounded-2xl border border-primary/15 bg-primary/5"><div className="flex items-start justify-between gap-3 border-b border-primary/10 p-4"><div><div className="text-[11px] font-semibold uppercase tracking-widest text-primary">Gợi ý dành riêng cho bạn</div><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Những quán được chọn từ khẩu vị bạn đã lưu.</p></div><div className="flex shrink-0 items-center gap-1"><button aria-label="Gợi ý trước" onClick={() => moveForYou(-1)} disabled={forYouBusy} className="rounded-full border border-primary/20 bg-background/60 p-1.5 text-primary hover:bg-background disabled:opacity-50"><ChevronLeft className="h-4 w-4" /></button><button aria-label="Gợi ý tiếp" onClick={() => moveForYou(1)} disabled={forYouBusy} className="rounded-full border border-primary/20 bg-background/60 p-1.5 text-primary hover:bg-background disabled:opacity-50"><ChevronRight className="h-4 w-4" /></button><button onClick={refreshForYou} disabled={forYouBusy} className="ml-1 rounded-full border border-primary/20 bg-background/60 px-3 py-1.5 text-xs font-medium text-primary hover:bg-background disabled:opacity-50">{forYouBusy ? "Đang tải…" : "Làm mới"}</button></div></div>{forYouBusy ? <div className="grid grid-cols-2 gap-3 p-4"><div className="h-[226px] rounded-xl bg-primary/10" /><div className="h-[226px] rounded-xl bg-primary/10" /></div> : forYou.length > 0 ? <div ref={forYouCarouselRef} className="flex ml-4 snap-x snap-mandatory gap-4 overflow-x-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{forYou.slice(0, 8).map((item) => <div key={item.restaurant.id} className="min-w-0 shrink-0 basis-[calc((100%_-_1rem)/2)] snap-start"><RestaurantResult id={item.restaurant.id} restaurant={toRestaurant(item.restaurant)} explanation={item.explanation} compact /></div>)}</div> : <div className="p-4 pt-1"><p className="text-xs text-muted-foreground">Chưa có gợi ý đủ phù hợp.</p><Link to="/profile" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Cập nhật khẩu vị để Bếp hiểu bạn hơn →</Link></div>}</section>}
           <div className="mt-8 text-[11px] uppercase tracking-widest text-muted-foreground">Thử hỏi</div>
          <Stagger className="mt-3 flex flex-wrap gap-2">{suggestions.map((item) => <StaggerItem key={item}><button onClick={() => void send(item)} className="pressable rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground/80 hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary">{item}</button></StaggerItem>)}</Stagger>
        </div>
      ) : (
        <div className="flex-1 space-y-5 overflow-auto py-6">
           {turns.map((turn, index) => <div key={`${turn.query}-${index}`} className="space-y-2 border-t border-border/60 pt-4">{turn.role !== "system" && <div className="ml-auto max-w-[90%] rounded-2xl bg-primary/10 px-4 py-3 text-sm">{turn.query}</div>}<div className={turn.role === "system" ? "rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground" : "text-sm leading-6"}>{turn.role === "system" && "✓ "}{turn.answer}</div>{index === turns.length - 1 && <InterpretationChips value={interpreted} />}</div>)}
           {busy && pendingQuery && <div className="space-y-3 border-t border-border/60 pt-4"><div className="ml-auto max-w-[90%] rounded-2xl bg-primary/10 px-4 py-3 text-sm">{pendingQuery}</div><div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>Bếp đang nghĩ…</span><button onClick={cancel} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:text-primary">Dừng</button></div></div>}
        </div>
      )}
      <div className="sticky bottom-16 z-30 space-y-3 bg-background pb-3 pt-2 md:bottom-0 md:pb-4">
        {showFilters && <FilterPanel filters={filters} toggleAttr={toggleAttr} onChange={refineSearch} hasLocation={location !== null} onLocate={locate} onPreset={() => textareaRef.current?.focus()} />}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowFilters((value) => !value)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" />Khẩu vị{activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-white">{activeCount}</span>}</button>
          <button onClick={locate} disabled={locationBusy} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${location ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"}`}><LocateFixed className="h-3.5 w-3.5" />{locationBusy ? "Đang định vị…" : location ? "Đã lấy vị trí" : "Vị trí"}</button>
          {filters.attrs.map((attr) => <button key={attr} onClick={() => toggleAttr(attr)} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">{attrLabel(attr)}<X className="h-3 w-3" /></button>)}
          {filters.maxDistanceKm && <FilterChip label={`Trong ${filters.maxDistanceKm}km`} onRemove={() => refineSearch({ ...filters, maxDistanceKm: undefined })} />}
          {filters.minRating !== undefined && <FilterChip label={`★ ${filters.minRating}+`} onRemove={() => refineSearch({ ...filters, minRating: undefined })} />}
          {filters.priceLevel !== undefined && <FilterChip label={`Giá ${filters.priceLevel}`} onRemove={() => refineSearch({ ...filters, priceLevel: undefined })} />}
          {filters.openNow && <FilterChip label="Đang mở" onRemove={() => refineSearch({ ...filters, openNow: false })} />}
          {submitted && <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" />Bắt đầu lại</button>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-lift">
          <textarea ref={textareaRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} className="min-h-20 w-full resize-none bg-transparent text-sm outline-none" placeholder="Hôm nay bạn thèm gì? Kể tự nhiên thôi…" />
          <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground"><span>Enter để gửi · Shift + Enter để xuống dòng</span><button aria-label="Gửi câu hỏi" onClick={() => void send()} disabled={busy || !query.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="h-4 w-4" />}</button></div>
        </div>
      </div>
    </div>
  );
  if (!submitted) return <div className="flex min-h-screen flex-col"><Header /><main className="container-page flex w-full flex-1 flex-col pb-24 md:pb-6"><div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">{chatPane}</div></main></div>;
  return <div className="flex min-h-screen flex-col">
    <Header />
    <main className="w-full flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-4">
      <div className="grid gap-4 lg:h-[calc(100vh-6rem)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,22rem)]">
        <aside className="order-2 min-h-0 overflow-y-auto lg:order-1">
          <SearchContextChips context={searchContext} onRemove={(next) => refineSearch(next)} />
          <div className="mb-2 mt-4 text-[11px] uppercase tracking-widest text-muted-foreground">Quán gợi ý ({resultRestaurants.length})</div>
          {resultRestaurants.length ? <Stagger className="space-y-2">{resultRestaurants.map((restaurant, index) => <StaggerItem key={restaurant.id} onMouseEnter={() => setActive(restaurant.id)}><RestaurantResult id={restaurant.id} restaurant={restaurant} explanation={result[index]?.explanation} matchingNames={matchingDishNames.get(restaurant.id)} onSelect={() => setActive(restaurant.id)} compact /></StaggerItem>)}</Stagger> : <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground"><p className="font-medium text-foreground">Không có quán nào khớp bộ lọc hiện tại.</p><p className="mt-2">Thử mở rộng bán kính, bỏ bớt một bộ lọc hoặc xem lại tất cả kết quả phù hợp với từ khóa.</p><button type="button" onClick={() => refineSearch({ ...filters, maxDistanceKm: undefined, minRating: undefined, priceLevel: undefined, openNow: false })} className="mt-3 rounded-full bg-foreground px-3 py-1.5 text-xs text-background">Bỏ bộ lọc giới hạn</button></div>}
          <div className="mb-2 mt-5 text-[11px] uppercase tracking-widest text-muted-foreground">Món hợp gu</div>
          <Stagger className="space-y-2">{resultDishes.map((dish) => <StaggerItem key={dish.id}><DishResult id={dish.id} dish={dish} /></StaggerItem>)}</Stagger>
        </aside>
        <div className="relative order-3 h-[280px] overflow-hidden rounded-2xl border border-border bg-parchment lg:order-2 lg:h-full"><MapCanvas restaurants={resultRestaurants} activeId={active} onHover={setActive} userLocation={location ? [location.latitude, location.longitude] : null} /></div>
        <section className="order-1 flex min-h-0 flex-col rounded-2xl border border-border bg-card/40 p-3 lg:order-3">{chatPane}</section>
      </div>
    </main>
  </div>;
}

function toAskDish(item: BackendDish): Dish { return { id: item.id, name: item.name, vi: item.description ?? item.restaurantName, cuisine: item.restaurantName, category: item.category ?? "Món ăn", price: item.priceAmount ?? 0, rating: 0, attrs: [], image: item.imageUrl ?? "/no-photo.svg", restaurantId: item.restaurantId, restaurantName: item.restaurantName }; }

function SearchContextChips({ context, onRemove }: { context: SearchContext; onRemove: (filters: Filters) => void }) {
  const chips: Array<{ label: string; remove: () => void }> = [];
  if (context.keyword) chips.push({ label: `🍜 ${context.keyword}`, remove: () => undefined });
  context.filters.attrs.forEach((attr) => chips.push({ label: attrLabel(attr), remove: () => onRemove({ ...context.filters, attrs: context.filters.attrs.filter((value) => value !== attr) }) }));
  if (context.filters.maxDistanceKm) chips.push({ label: `📍 Trong ${context.filters.maxDistanceKm} km`, remove: () => onRemove({ ...context.filters, maxDistanceKm: undefined }) });
  if (context.filters.minRating !== undefined) chips.push({ label: `⭐ ${context.filters.minRating}+`, remove: () => onRemove({ ...context.filters, minRating: undefined }) });
  if (context.filters.priceLevel !== undefined) chips.push({ label: `💰 Giá ${context.filters.priceLevel}`, remove: () => onRemove({ ...context.filters, priceLevel: undefined }) });
  if (context.filters.openNow) chips.push({ label: "🕒 Đang mở", remove: () => onRemove({ ...context.filters, openNow: false }) });
  return <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-primary">Đang tìm kiếm</div><div className="flex flex-wrap gap-1.5">{chips.map((chip) => <button key={chip.label} type="button" onClick={chip.remove} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-background px-2.5 py-1.5 text-xs text-primary hover:border-primary">{chip.label}<X className="h-3 w-3" /></button>)}<span className="self-center text-[11px] text-muted-foreground">Sắp xếp: {context.sort === "distance" ? "Khoảng cách" : context.sort === "rating" ? "Đánh giá" : "Liên quan"}</span></div></div>;
}

function InterpretationChips({ value }: { value: InterpretedSearch | null }) {
  if (!value) return null;
  const chips = [
    value.filters.category ? `Nhóm: ${value.filters.category}` : null,
    value.filters.district ? `Khu vực: ${value.filters.district}` : null,
    ...value.filters.attributes.map((attribute) => `Mục đích: ${attribute}`),
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-1.5" aria-label="Tiêu chí Bếp đã hiểu">{chips.map((chip) => <span key={chip} className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] text-primary">{chip}</span>)}</div>;
}

function FilterPanel({ filters, toggleAttr, onChange, hasLocation, onLocate, onPreset }: { filters: Filters; toggleAttr: (value: string) => void; onChange: (next: Filters) => void; hasLocation: boolean; onLocate: () => void; onPreset: (value?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [openGroup, setOpenGroup] = useState("feel");
  const visibleGroups = expanded ? filterGroups : filterGroups.slice(0, 2);
  const applyQuick = (preset: (typeof quickFilters)[number]) => onChange({ ...filters, attrs: preset.attrs ?? [], maxDistanceKm: preset.maxDistanceKm, openNow: preset.openNow ?? false });
  return <div className="rounded-2xl border border-border bg-card p-3 shadow-soft"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Chọn nhanh theo nhu cầu</div><p className="mt-0.5 text-[11px] text-muted-foreground">Không cần chọn từng khẩu vị nếu bạn chỉ muốn bắt đầu nhanh.</p></div><button onClick={() => onChange({ attrs: [], openNow: false })} className="text-[11px] text-muted-foreground hover:text-foreground">Đặt lại</button></div><div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">{quickFilters.map((preset) => <button key={preset.label} onClick={() => { applyQuick(preset); if (preset.maxDistanceKm && !hasLocation) onLocate(); onPreset(preset.query); }} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary">{preset.label}</button>)}</div><div className="mt-3 space-y-1.5">{visibleGroups.map((group) => { const selected = group.options.filter((option) => filters.attrs.includes(option.value)).length; const isOpen = openGroup === group.key; return <div key={group.key} className="rounded-xl border border-border/70"><button onClick={() => setOpenGroup(isOpen ? "" : group.key)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-medium"><span>{group.title}{selected > 0 && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{selected}</span>}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} /></button>{isOpen && <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 pb-3 pt-2">{group.options.map((option) => <button key={option.value} onClick={() => toggleAttr(option.value)} className={`rounded-full border px-3 py-1.5 text-xs ${filters.attrs.includes(option.value) ? "border-primary bg-primary text-white" : "border-border"}`}>{option.label}</button>)}</div>}</div>; })}</div>{filterGroups.length > 2 && <button onClick={() => setExpanded((value) => !value)} className="mt-2 text-xs font-medium text-primary hover:underline">{expanded ? "Thu gọn khẩu vị" : `Xem thêm ${filterGroups.length - 2} nhóm khẩu vị`}</button>}<div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3"><span className="self-center pr-1 text-[11px] text-muted-foreground">Khác</span>{distanceOptions.map((item) => <button key={item.value} onClick={() => { const nextDistance = filters.maxDistanceKm === item.value ? undefined : item.value; onChange({ ...filters, maxDistanceKm: nextDistance }); if (nextDistance && !hasLocation) onLocate(); }} className={`rounded-full border px-3 py-1.5 text-xs ${filters.maxDistanceKm === item.value ? "border-primary bg-primary text-white" : "border-border"}`}>{item.label}</button>)}<button onClick={() => onChange({ ...filters, openNow: !filters.openNow })} className={`rounded-full border px-3 py-1.5 text-xs ${filters.openNow ? "border-primary bg-primary text-white" : "border-border"}`}>Đang mở</button></div><div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3"><button onClick={() => onChange({ ...filters, minRating: filters.minRating === 4.5 ? undefined : 4.5 })} className={`rounded-full border px-3 py-1.5 text-xs ${filters.minRating ? "border-primary bg-primary text-white" : "border-border"}`}>★ 4.5+</button>{[1, 2, 3, 4].map((price) => <button key={price} onClick={() => onChange({ ...filters, priceLevel: filters.priceLevel === price ? undefined : price })} className={`rounded-full border px-3 py-1.5 text-xs ${filters.priceLevel === price ? "border-primary bg-primary text-white" : "border-border"}`}>Giá {price}</button>)}</div></div>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <button onClick={onRemove} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">{label}<X className="h-3 w-3" /></button>; }
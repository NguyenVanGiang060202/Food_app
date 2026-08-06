import { lazy, Suspense, useEffect, useState } from "react";
import { createBrowserRouter, Link, RouterProvider, useLocation } from "react-router-dom";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Sparkles } from "lucide-react";
import { Header } from "./components/site/Header";
import { Footer } from "./components/site/Footer";
import { RestaurantCard, RestaurantCardSkeleton } from "./components/site/cards";
import { SaveRestaurantButton } from "./components/site/SaveRestaurantButton";
import { type Restaurant } from "./lib/food-data";
import { detailToRestaurant, getPreferences, getRestaurant, listCategories, listRestaurants, listSavedRestaurantsPage, searchRestaurants, signOut, updatePreferences, type BackendCategory, type BackendRestaurantDetail, type UserPreferences } from "./lib/api";
import { AskPage } from "./pages/AskPage";
import { useAuth } from "./hooks/useAuth";
import { Reveal, Stagger, StaggerItem } from "./lib/motion";

const SourceMapPage = lazy(() => import("./pages/MapPage").then(({ MapPage }) => ({ default: MapPage })));
const AuthPage = lazy(() => import("./pages/AuthPage").then(({ AuthPage }) => ({ default: AuthPage })));

function DiscoverPage() {
  const [catalog, setCatalog] = useState<Restaurant[]>([]);
  const [categories, setCategories] = useState<BackendCategory[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listRestaurants({ limit: 12, sort: "rating" }), listCategories()]).then(([restaurantsResult, categoriesResult]) => {
      if (cancelled) return;
      setCatalog(restaurantsResult.status === "fulfilled" ? restaurantsResult.value : []);
      setCategories(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  return <><section className="container-page pt-10 md:pt-14"><Reveal><h1 className="mt-2 max-w-2xl text-balance font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">Dạo món trước khi <em className="italic text-primary">chốt kèo</em>.</h1></Reveal></section><section className="container-page py-16"><Reveal><div className="flex items-end justify-between gap-4"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Quán đang thơm</div><h2 className="mt-2 font-display text-3xl md:text-4xl">Được thực khách khen nhiều</h2></div><div className="hidden gap-2 sm:flex"><button type="button" aria-label="Quán trước" className="rounded-full border border-border bg-card p-2"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Quán tiếp theo" className="rounded-full border border-border bg-card p-2"><ChevronRight className="h-4 w-4" /></button></div></div></Reveal><div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{busy ? Array.from({ length: 6 }).map((_, index) => <RestaurantCardSkeleton key={index} />) : catalog.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>{!busy && catalog.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Bếp chưa có quán để dọn ra.</p>}</section><section className="bg-ink text-background"><div className="container-page py-16"><Reveal><div className="grid gap-10 md:grid-cols-[1fr,2fr]"><div><div className="text-xs uppercase tracking-widest text-mustard">Theo ẩm thực</div><h2 className="mt-2 font-display text-3xl">Một thế giới bàn ăn,<br />xếp theo gian bếp.</h2></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{categories.slice(0, 12).map((category) => <Link key={category.slug} to={`/?prompt=${encodeURIComponent(`Gợi ý những nhà hàng ${category.name} ngon và được đánh giá cao gần tôi.`)}`} aria-label={`Hỏi Bếp về nhóm ${category.name}`} className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20 hover:bg-white/10"><div className="font-display text-xl">{category.name}</div><span className="mt-4 inline-block text-xs text-mustard opacity-0 transition-opacity group-hover:opacity-100">Hỏi Bếp →</span></Link>)}{!busy && categories.length === 0 && <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-background/70">Bếp chưa có nhóm ẩm thực để phân mâm.</div>}</div></div></Reveal></div></section><Footer /></>;
}

function ExplorePage() {
  const [trending, setTrending] = useState<Restaurant[]>([]);
  useEffect(() => { void listRestaurants({ limit: 6, sort: "rating" }).then(setTrending).catch(() => setTrending([])); }, []);
  return <main className="container-page pb-24"><section className="relative overflow-hidden rounded-b-[2.5rem] bg-ink px-6 py-14 text-background md:px-12 md:py-20"><div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" /><div className="relative max-w-2xl"><div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.2em] text-mustard"><Sparkles className="h-4 w-4" /> Dạo món theo cảm hứng</div><h1 className="mt-5 font-display text-5xl leading-[.98] md:text-7xl">Hôm nay bạn muốn <em className="italic text-primary">ăn gì?</em></h1><p className="mt-5 max-w-lg text-base leading-7 text-background/70">Không cần biết tên món. Chọn một cảm giác, một dịp, hoặc một gian bếp; Bếp sẽ tìm phần còn lại cho bạn.</p><Link to="/" className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"><MessageCircle className="h-4 w-4" /> Hỏi Bếp điều bạn đang thèm</Link></div></section><section className="pt-16"><div className="flex items-end justify-between gap-4"><SectionHeading eyebrow="Đang được chú ý" title="Quán nổi bật" text="Những địa điểm đang được thực khách để ý nhiều hơn." /><Link to="/" className="mb-1 hidden shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline sm:inline-flex">Hỏi Bếp để tìm thêm <ArrowRight className="h-4 w-4" /></Link></div><Stagger className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{trending.map((restaurant) => <StaggerItem key={restaurant.id}><RestaurantCard r={restaurant} /></StaggerItem>)}{trending.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">Các quán nổi bật đang được cập nhật.</div>}</Stagger></section><section className="mt-16 rounded-3xl border border-primary/15 bg-primary/5 p-7 md:p-10"><div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary"><CalendarDays className="h-4 w-4" /> Gợi ý theo mùa</div><h2 className="mt-2 font-display text-3xl">Cuối tuần này ăn gì?</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Hỏi Bếp về brunch, món ngày mưa, đồ uống mùa hè hoặc bất kỳ cảm hứng theo mùa nào bạn đang nghĩ tới.</p></div><Link to={`/?prompt=${encodeURIComponent("Gợi ý những địa điểm phù hợp cho cuối tuần này, gần tôi.")}`} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90">Gợi ý cho tôi <ArrowRight className="h-4 w-4" /></Link></div></section></main>;
}

function SavedPage() {
  const { user, loading } = useAuth();
  const [saved, setSaved] = useState<Restaurant[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!user) return; setBusy(true); void listSavedRestaurantsPage({ limit: 15 }).then((page) => setSaved(page.data)).catch(() => setSaved([])).finally(() => setBusy(false)); }, [user]);
  if (loading) return null;
  if (!user) return <main className="container-page min-h-[70vh] py-16"><h1 className="font-display text-4xl">Cất quán cần có sổ gu</h1><p className="mt-3 text-muted-foreground">Vào Bếp để lưu lại những quán muốn thử.</p><Link className="mt-5 inline-block rounded-full bg-primary px-5 py-3 text-sm font-medium text-white" to="/auth?returnTo=/saved">Vào Bếp</Link></main>;
  return <main className="container-page min-h-[70vh] py-10"><div className="text-xs font-bold uppercase tracking-[.18em] text-primary">SỔ QUÁN CỦA BẠN</div><h1 className="mt-2 font-display text-4xl">Quán đã cất</h1>{busy ? <p className="mt-8 text-sm text-muted-foreground">Bếp đang mở sổ quán...</p> : <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{saved.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>}{!busy && saved.length === 0 && <p className="mt-8 text-sm text-muted-foreground">Sổ quán còn trống. Đi dạo món rồi cất vài quán nhé.</p>}</main>;
}

function RestaurantDetailPage() {
  const id = useLocation().pathname.split("/").filter(Boolean).pop() ?? "";
  const [detail, setDetail] = useState<BackendRestaurantDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let cancelled = false; setDetail(null); setFailed(false); void getRestaurant(id).then((value) => { if (!cancelled) setDetail(value); }).catch(() => { if (!cancelled) setFailed(true); }); return () => { cancelled = true; }; }, [id]);
  if (failed) return <main className="container-page py-20"><p className="text-muted-foreground">Không thể tải thông tin quán.</p><Link to="/discover" className="mt-4 inline-block text-primary hover:underline">Quay lại dạo món</Link></main>;
  if (!detail) return <main className="container-page py-20"><p className="text-muted-foreground">Đang tải thông tin quán...</p></main>;
  const restaurant = detailToRestaurant(detail);
  return <main className="container-page py-10 pb-24 md:pb-16"><Link to="/discover" className="text-sm text-muted-foreground hover:text-foreground">Quay lại dạo món</Link><div className="mt-6 grid gap-8 md:grid-cols-[1.1fr,1fr]"><img src={restaurant.image ?? "/no-photo.svg"} alt={restaurant.image ? restaurant.name : "Chưa có ảnh"} className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift" /><div><div className="text-xs uppercase tracking-widest text-muted-foreground">{restaurant.cuisine.join(" · ")}</div><div className="mt-2 flex items-start justify-between gap-4"><h1 className="font-display text-4xl md:text-5xl">{restaurant.name}</h1><SaveRestaurantButton restaurantId={restaurant.id} size="large" /></div><div className="mt-4 text-sm text-muted-foreground">{restaurant.area}</div>{restaurant.description && <p className="mt-6 text-muted-foreground">{restaurant.description}</p>}<div className="mt-6"><a href={restaurant.sourceUrl ?? undefined} target="_blank" rel="noreferrer" className={`inline-flex rounded-full border border-border px-4 py-2 text-sm ${restaurant.sourceUrl ? "hover:border-primary hover:text-primary" : "pointer-events-none text-muted-foreground"}`}>{restaurant.sourceUrl ? "Mở trong Google Maps" : "Nguồn Google Maps chưa rõ"}</a></div></div></div></main>;
}

function ProfilePage() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>({ favoriteCategorySlugs: [], dietaryPreferences: [], preferredPriceLevels: [], aiPreferences: { favoriteFoodSlugs: [], favoriteCuisineSlugs: [], tastePreferences: [], dietaryPreferences: [], diningStyles: [], restaurantFeatures: [], memories: [] } });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!user) return; void getPreferences().then(setPreferences).catch(() => undefined).finally(() => setBusy(false)); }, [user]);
  if (!user) return <main className="container-page py-20"><h1 className="font-display text-4xl">Bạn chưa vào Bếp</h1><Link className="mt-5 inline-block text-primary" to="/auth">Vào Bếp</Link></main>;
  const save = async () => { const saved = await updatePreferences(preferences); setPreferences(saved); setNotice("Đã lưu sổ gu. Bếp sẽ nhớ kỹ hơn khi gợi ý món."); };
  return <main className="container-page min-h-[70vh] py-10 pb-24 md:py-14"><div className="max-w-3xl"><div className="text-xs font-bold uppercase tracking-[.18em] text-primary">GU RUỘT</div><h1 className="mt-3 font-display text-5xl leading-tight">Dạy Bếp hiểu bạn hơn.</h1><p className="mt-3 max-w-2xl text-muted-foreground">Mỗi lựa chọn giúp Hỏi Bếp gợi ý tự nhiên hơn, ngắn hơn và đúng gu hơn.</p><section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-soft"><h2 className="font-display text-2xl">Tài khoản</h2><p className="mt-2 text-sm text-muted-foreground">{user.displayName || user.email}</p><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => void save()} disabled={busy} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white">Lưu sổ gu</button><button onClick={() => { void signOut().finally(() => { window.location.href = "/"; }); }} className="rounded-full border border-border px-5 py-2 text-sm">Đăng xuất</button></div>{notice && <p className="mt-4 text-sm text-primary">{notice}</p>}</section></div></main>;
}

function SearchPage() {
  const query = new URLSearchParams(useLocation().search).get("q") ?? "";
  const [items, setItems] = useState<Restaurant[]>([]);
  useEffect(() => { void searchRestaurants(query).then(setItems).catch(() => setItems([])); }, [query]);
  return <main className="container-page py-12 pb-24"><h1 className="font-display text-4xl">Tìm kiếm</h1><p className="mt-2 text-muted-foreground">Kết quả thật cho "{query}"</p><div className="mt-8 grid gap-4 md:grid-cols-2">{items.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>{items.length === 0 && <p className="mt-8 text-sm text-muted-foreground">Không tìm thấy quán phù hợp.</p>}</main>;
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div><div className="text-xs uppercase tracking-[.18em] text-primary">{eyebrow}</div><h2 className="mt-2 font-display text-3xl md:text-4xl">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{text}</p></div>; }
function NotFound() { return <main className="container-page py-20"><h1 className="font-display text-4xl">Không tìm thấy trang</h1><Link className="mt-5 inline-block text-primary" to="/">Về bàn chính</Link></main>; }

const router = createBrowserRouter([
  { path: "/auth", element: <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-muted-foreground">Đang tải...</main>}><AuthPage /></Suspense> },
  { path: "/", element: <AskPage /> },
  { path: "/discover", element: <><Header /><DiscoverPage /></> },
  { path: "/map", element: <Suspense fallback={<main className="container-page py-20 text-sm text-muted-foreground">Đang tải bản đồ...</main>}><SourceMapPage /><Footer /></Suspense> },
  { path: "/saved", element: <><Header /><SavedPage /><Footer /></> },
  { path: "/search", element: <><Header /><SearchPage /><Footer /></> },
  { path: "/restaurants/:id", element: <><Header /><RestaurantDetailPage /><Footer /></> },
  { path: "/profile", element: <><Header /><ProfilePage /><Footer /></> },
  { path: "*", element: <><Header /><NotFound /><Footer /></> },
]);

export function App() { return <RouterProvider router={router} />; }

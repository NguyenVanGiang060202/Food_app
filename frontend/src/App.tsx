import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createBrowserRouter, Link, RouterProvider, useLocation } from "react-router-dom";
import { ArrowRight, Bookmark, CalendarDays, ChevronLeft, ChevronRight, Clock, Coffee, Heart, MapPin, MessageCircle, Moon, Share2, Sparkles, Star, Users, Utensils, Zap } from "lucide-react";
import { Header } from "./components/site/Header";
import { Footer } from "./components/site/Footer";
import { DishCard, RestaurantCard } from "./components/site/cards";
import { type Restaurant, type Dish } from "./lib/food-data";
import { detailToRestaurant, getDish, getPreferences, getRestaurant, getSimilarRestaurants, listCategories, listDishes, listRestaurants, listSavedRestaurantsPage, searchRestaurants, setCachedSavedStatus, signOut, toDish, updatePreferences, type BackendDish, type BackendRestaurantDetail, type BackendCategory, type UserPreferences } from "./lib/api";
import { AskPage } from "./pages/AskPage";
import { SaveRestaurantButton } from "./components/site/SaveRestaurantButton";
import { useAuth } from "./hooks/useAuth";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Reveal, Stagger, StaggerItem } from "./lib/motion";

const SourceMapPage = lazy(() => import("./pages/MapPage").then(({ MapPage }) => ({ default: MapPage })));
const AuthPage = lazy(() => import("./pages/AuthPage").then(({ AuthPage }) => ({ default: AuthPage })));

function DiscoverPage() {
  const [catalog, setCatalog] = useState<Restaurant[]>([]);
  const [categories, setCategories] = useState<BackendCategory[]>([]);
  const [busy, setBusy] = useState(true);
  const [categoriesBusy, setCategoriesBusy] = useState(true);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const ratingsCarouselRef = useRef<HTMLDivElement>(null);

  const moveRatings = (direction: number) => {
    ratingsCarouselRef.current?.scrollBy({ left: direction * 376, behavior: "smooth" });
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listRestaurants({ limit: 12, sort: "rating" }), listCategories()])
      .then(([restaurantsResult, categoriesResult]) => {
        if (cancelled) return;
        setCatalog(restaurantsResult.status === "fulfilled" ? restaurantsResult.value : []);
        if (categoriesResult.status === "fulfilled") {
          setCategories(categoriesResult.value.filter((category) => category.restaurantCount > 0));
          setCategoriesFailed(false);
        } else {
          setCategories([]);
          setCategoriesFailed(true);
        }
      })
      .finally(() => { if (!cancelled) { setBusy(false); setCategoriesBusy(false); } });
    return () => { cancelled = true; };
  }, []);

  return <>
    <section className="container-page pt-10 md:pt-14">
      <Reveal><h1 className="mt-2 max-w-2xl text-balance font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">Những quán thành phố <em className="italic text-primary">đang biết đến</em>.</h1></Reveal>
    </section>
    <section className="container-page py-16">
      <Reveal><div className="flex items-end justify-between gap-4"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Dữ liệu nổi bật</div><h2 className="mt-2 font-display text-3xl md:text-4xl">Quán được đánh giá cao</h2></div><div className="flex gap-2"><button type="button" aria-label="Quán trước" onClick={() => moveRatings(-1)} className="rounded-full border border-border bg-card p-2 transition-colors hover:border-primary hover:text-primary"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Quán tiếp theo" onClick={() => moveRatings(1)} className="rounded-full border border-border bg-card p-2 transition-colors hover:border-primary hover:text-primary"><ChevronRight className="h-4 w-4" /></button></div></div></Reveal>
      <div ref={ratingsCarouselRef} style={{ touchAction: "pan-x" }} className="mt-8 flex cursor-grab select-none snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-1 pb-3 active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{catalog.slice(0, 12).map((restaurant) => <div key={restaurant.id} className="w-[min(82vw,360px)] shrink-0 snap-start sm:w-[360px]"><RestaurantCard r={restaurant} /></div>)}</div>
      {!busy && catalog.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Chưa có quán khả dụng trong database.</p>}
    </section>
    <section className="bg-ink text-background">
      <div className="container-page py-16">
        <Reveal><div className="grid gap-10 md:grid-cols-[1fr,2fr]">
          <div><div className="text-xs uppercase tracking-widest text-mustard">Theo ẩm thực</div><h2 className="mt-2 font-display text-3xl">Một thế giới bàn ăn,<br />xếp theo gian bếp.</h2></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categories.slice(0, 12).map((category) => <Link key={category.slug} to={`/?prompt=${encodeURIComponent(`Gợi ý những nhà hàng ${category.name} ngon và được đánh giá cao gần tôi.`)}`} aria-label={`Hỏi Bếp về nhóm ${category.name}`} className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20 hover:bg-white/10"><div className="font-display text-xl">{category.name}</div><div className="mt-1 text-xs text-background/60">{category.restaurantCount} quán</div><span className="mt-4 inline-block text-xs text-mustard opacity-0 transition-opacity group-hover:opacity-100">Hỏi Bếp →</span></Link>)}
            {categoriesBusy && <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-background/70">Đang tải các nhóm ẩm thực…</div>}
            {!categoriesBusy && categoriesFailed && <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-background/70">Chưa thể tải nhóm ẩm thực. Thử tải lại trang nhé.</div>}
            {!categoriesBusy && !categoriesFailed && categories.length === 0 && <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-background/70">Chưa có nhóm ẩm thực nào có quán đang hoạt động.</div>}
          </div>
        </div></Reveal>
      </div>
    </section>
    <section className="container-page py-16">
      <Reveal>
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Chọn theo cảm hứng</div>
        <h2 className="mt-2 max-w-xl font-display text-3xl">Không biết gọi gì? Bắt đầu từ một cảm giác.</h2>
        <Stagger className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[{ title: "Nóng và có nước", text: "Phở, bún, mì và những món ấm bụng.", query: "món nóng có nước" }, { title: "Ăn nhẹ buổi chiều", text: "Một món vừa đủ, không quá nặng bụng.", query: "ăn nhẹ" }, { title: "Cay để tỉnh táo", text: "Đậm vị hơn cho ngày cần năng lượng.", query: "món cay" }, { title: "Bữa trưa chắc bụng", text: "Gợi ý nhanh cho một bữa ăn tử tế.", query: "bữa trưa" }].map((mood) => <StaggerItem key={mood.title}><Link to={`/?prompt=${encodeURIComponent(mood.query)}`} className="block h-full rounded-2xl border border-border bg-card p-5 shadow-soft pressable transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lift"><div className="font-display text-xl">{mood.title}</div><p className="mt-2 text-sm leading-5 text-muted-foreground">{mood.text}</p><span className="mt-5 inline-block text-xs font-medium text-primary">Hỏi Bếp →</span></Link></StaggerItem>)}
        </Stagger>
      </div>
      </Reveal>
    </section>
    <Footer />
  </>;
}


function toDiscoverDish(item: BackendDish): Dish { return { id: item.id, name: item.name, vi: item.description ?? `${item.restaurantName}${item.isPopular ? " · Món phổ biến" : ""}`, cuisine: item.restaurantName, category: item.category ?? "Món ăn", price: item.priceAmount ?? 0, rating: 0, attrs: [], image: item.imageUrl ?? "/no-photo.svg", restaurantId: item.restaurantId, restaurantName: item.restaurantName }; }

function GoogleIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z" /><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z" /><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" /></svg>;
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>{children}</div>;
}

 function SavedPage() { const { user, loading } = useAuth(); const [saved, setSaved] = useState<Restaurant[]>([]); const [pageMeta, setPageMeta] = useState({ nextCursor: null as string | null, totalCount: 0, totalPages: 0 }); const [cursorStack, setCursorStack] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); useEffect(() => { if (!user?.id) return; const userId = user.id; let cancelled = false; setBusy(true); setError(""); void listSavedRestaurantsPage({ limit: 15, cursor: cursorStack[cursorStack.length - 1] }).then((page) => { if (cancelled) return; page.data.forEach((restaurant) => setCachedSavedStatus(userId, restaurant.id, true)); setSaved(page.data); setPageMeta({ nextCursor: page.meta.nextCursor, totalCount: page.meta.totalCount, totalPages: page.meta.totalPages }); }).catch((cause) => { if (cancelled) return; setSaved([]); setPageMeta({ nextCursor: null, totalCount: 0, totalPages: 0 }); setError(cause instanceof Error ? cause.message : "Không thể tải danh sách đã lưu."); }).finally(() => { if (!cancelled) setBusy(false); }); return () => { cancelled = true; }; }, [user, cursorStack]); if (loading) return null; const goNext = () => { if (pageMeta.nextCursor) setCursorStack((current) => [...current, pageMeta.nextCursor!]); }; const goPrevious = () => setCursorStack((current) => current.slice(0, -1)); const currentPage = cursorStack.length + 1; return <main className="container-page min-h-[70vh] py-4 pb-8 md:py-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">ĐỊA ĐIỂM CỦA BẠN</div><div className="mt-1 flex items-end justify-between gap-3"><h1 className="font-display text-3xl md:text-4xl">Đã lưu</h1>{user && !busy && !error && pageMeta.totalCount > 0 && <span className="text-[11px] text-muted-foreground">{pageMeta.totalCount} địa điểm · trang {currentPage}/{pageMeta.totalPages}</span>}</div>{!user ? <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center"><Bookmark className="mx-auto h-8 w-8 text-primary" /><div className="mt-4 font-display text-2xl">Lưu lại để ăn sau</div><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Đăng nhập để giữ danh sách món và quán yêu thích.</p><Link to="/auth" className="mt-6 inline-flex rounded-full bg-foreground px-5 py-2 text-sm text-background">Đăng nhập</Link></div> : busy ? <p className="mt-8 text-sm text-muted-foreground">Đang tải danh sách đã lưu…</p> : error ? <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive"><p>{error}</p><button type="button" onClick={() => setCursorStack((current) => [...current])} className="mt-4 rounded-full border border-destructive/30 px-4 py-2">Thử lại</button></div> : saved.length ? <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">{saved.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} dense saved />)}</div><nav aria-label="Phân trang địa điểm đã lưu" className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-4"><button type="button" onClick={goPrevious} disabled={cursorStack.length === 0 || busy} className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">← Trang trước</button><div className="flex items-center gap-1.5"><span className="min-w-8 rounded-full bg-primary px-2.5 py-1 text-center text-xs font-medium text-primary-foreground">{currentPage}</span><span className="text-xs text-muted-foreground">/ {pageMeta.totalPages}</span></div><button type="button" onClick={goNext} disabled={!pageMeta.nextCursor || busy} className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">Trang sau →</button></nav></> : <p className="mt-6 text-sm text-muted-foreground">Chưa có gì được lưu. Hỏi Bếp một câu rồi lưu món bạn thích.</p>}</main>; }

type InspirationCard = { title: string; description: string; prompt: string; image: string; icon?: React.ReactNode };

const cuisineCards: InspirationCard[] = [
  { title: "Việt Nam", description: "Phở, bún và những hương vị thân quen.", prompt: "Tìm những quán Việt Nam được đánh giá cao gần tôi.", image: "/hero-pho.jpg" },
  { title: "BBQ", description: "Nướng xèo xèo cho một bữa thật vui.", prompt: "Gợi ý những quán BBQ ngon, được đánh giá cao gần tôi.", image: "/dish-hotpot.jpg" },
  { title: "Sushi", description: "Thanh nhẹ, tinh tế, vừa đủ cuốn.", prompt: "Tìm nhà hàng sushi chất lượng gần tôi.", image: "/dish-banhmi.jpg" },
  { title: "Pizza", description: "Một lát phô mai cho ngày muốn nuông chiều.", prompt: "Gợi ý pizza ngon cho hôm nay.", image: "/dish-comtam.jpg" },
  { title: "Cà phê", description: "Một góc nhỏ để tỉnh táo và thở chậm.", prompt: "Recommend good coffee shops nearby.", image: "/dish-coffee.jpg" },
  { title: "Chay", description: "Tươi lành, nhẹ bụng mà vẫn đủ vị.", prompt: "Tìm nhà hàng chay ngon và được đánh giá cao gần tôi.", image: "/dish-bunbo.jpg" },
  { title: "Lẩu", description: "Quây quần bên nồi nước dùng nghi ngút.", prompt: "Gợi ý quán lẩu ngon cho nhóm bạn gần tôi.", image: "/dish-hotpot.jpg" },
  { title: "Tráng miệng", description: "Một chút ngọt ngào để khép lại ngày.", prompt: "Tìm những địa điểm tráng miệng ngon gần tôi.", image: "/dish-milktea.jpg" },
  { title: "Hàn Quốc", description: "Đậm đà, vui miệng và nhiều món để chia sẻ.", prompt: "Gợi ý nhà hàng Hàn Quốc ngon gần tôi.", image: "/dish-banhmi.jpg" },
  { title: "Hải sản", description: "Vị biển tươi mới cho một bữa đáng nhớ.", prompt: "Tìm nhà hàng hải sản tươi ngon gần tôi.", image: "/dish-bunbo.jpg" },
];

const moodCards: InspirationCard[] = [
  { title: "Một món gì đó ấm", description: "Cho ngày mưa hoặc một chiếc bụng cần được vỗ về.", prompt: "Recommend something warm and comforting to eat today.", image: "/hero-pho.jpg", icon: <Coffee className="h-5 w-5" /> },
  { title: "Cay để tỉnh táo", description: "Đậm vị hơn một chút, năng lượng hơn một chút.", prompt: "Gợi ý món cay ngon để tôi tỉnh táo hôm nay.", image: "/dish-bunbo.jpg", icon: <Zap className="h-5 w-5" /> },
  { title: "Bữa ăn lành mạnh", description: "Ngon, đủ chất và dưới 200.000₫.", prompt: "Recommend healthy restaurants under 200,000 VND near me.", image: "/dish-comtam.jpg", icon: <Heart className="h-5 w-5" /> },
  { title: "Ăn khuya", description: "Khi cơn đói ghé thăm sau giờ bình thường.", prompt: "Tìm những quán ăn khuya ngon và đang mở gần tôi.", image: "/dish-hotpot.jpg", icon: <Moon className="h-5 w-5" /> },
  { title: "Ăn nhẹ buổi chiều", description: "Một món vừa đủ, không quá nặng bụng.", prompt: "Gợi ý một món ăn nhẹ cho buổi chiều hôm nay.", image: "/dish-milktea.jpg", icon: <Coffee className="h-5 w-5" /> },
  { title: "Nạp năng lượng", description: "Bữa trưa chắc bụng cho ngày bận rộn.", prompt: "Recommend a satisfying meal to boost my energy today.", image: "/dish-comtam.jpg", icon: <Zap className="h-5 w-5" /> },
];

const occasionCards: InspirationCard[] = [
  { title: "Date night", description: "Một nơi đủ riêng tư cho buổi tối đặc biệt.", prompt: "Recommend a romantic restaurant with a quiet atmosphere.", image: "/rest-1.jpg", icon: <Heart className="h-5 w-5" /> },
  { title: "Bữa cơm gia đình", description: "Món ngon để mọi thế hệ cùng ngồi lại.", prompt: "Gợi ý nhà hàng phù hợp cho bữa tối gia đình.", image: "/rest-2.jpg", icon: <Users className="h-5 w-5" /> },
  { title: "Hẹn hội bạn", description: "Không khí vui và menu để cùng chia sẻ.", prompt: "Tìm nhà hàng phù hợp cho một buổi tụ tập bạn bè.", image: "/rest-3.jpg", icon: <Users className="h-5 w-5" /> },
  { title: "Một mình một bữa", description: "Một chiếc bàn nhỏ, một món mình thích.", prompt: "Recommend a great restaurant for a solo meal.", image: "/dish-coffee.jpg", icon: <Coffee className="h-5 w-5" /> },
  { title: "Làm việc tại café", description: "Có đồ uống ngon và một góc ngồi dễ tập trung.", prompt: "Tìm quán cà phê phù hợp để làm việc gần tôi.", image: "/dish-coffee.jpg", icon: <Coffee className="h-5 w-5" /> },
  { title: "Bữa trưa nhanh", description: "Ăn tử tế dù chỉ có một khoảng nghỉ ngắn.", prompt: "Gợi ý một địa điểm ăn trưa nhanh và ngon gần tôi.", image: "/dish-banhmi.jpg", icon: <Utensils className="h-5 w-5" /> },
];

function PromptCard({ card, wide = false }: { card: InspirationCard; wide?: boolean }) {
  return <Link to={`/?prompt=${encodeURIComponent(card.prompt)}`} className={`group relative block overflow-hidden rounded-3xl bg-card shadow-soft pressable transition-all hover:-translate-y-1 hover:shadow-lift ${wide ? "min-h-[250px]" : "min-h-[220px]"}`}>
    <img src={card.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
    <div className="relative flex h-full min-h-[220px] flex-col justify-end p-5 text-white">
      {card.icon && <span className="mb-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">{card.icon}</span>}
      <h3 className="font-display text-2xl leading-tight">{card.title}</h3><p className="mt-1 max-w-xs text-sm leading-5 text-white/80">{card.description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-mustard">Hỏi Bếp ngay <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span>
    </div>
  </Link>;
}

function ExplorePage() {
  const [categories, setCategories] = useState<BackendCategory[]>([]);
  const [trending, setTrending] = useState<Restaurant[]>([]);
  useEffect(() => {
    void Promise.allSettled([listCategories(), listRestaurants({ limit: 6, sort: "rating" })]).then(([categoriesResult, restaurantsResult]) => {
      if (categoriesResult.status === "fulfilled") setCategories(categoriesResult.value);
      if (restaurantsResult.status === "fulfilled") setTrending(restaurantsResult.value);
    });
  }, []);
  const countFor = (title: string) => categories.find((category) => category.name.toLowerCase().includes(title.toLowerCase()) || category.slug === title.toLowerCase())?.restaurantCount;
  return <main className="container-page pb-24">
    <section className="relative overflow-hidden rounded-b-[2.5rem] bg-ink px-6 py-14 text-background md:px-12 md:py-20"><div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" /><div className="relative max-w-2xl"><div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.2em] text-mustard"><Sparkles className="h-4 w-4" /> Khám phá theo cảm hứng</div><h1 className="mt-5 font-display text-5xl leading-[.98] md:text-7xl">Hôm nay bạn muốn <em className="italic text-primary">ăn gì?</em></h1><p className="mt-5 max-w-lg text-base leading-7 text-background/70">Không cần biết tên món. Chọn một cảm giác, một dịp, hoặc một gian bếp — Bếp sẽ tìm phần còn lại cho bạn.</p><Link to="/" className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"><MessageCircle className="h-4 w-4" /> Hỏi Bếp điều bạn đang thèm</Link></div></section>
    <section className="pt-14"><SectionHeading eyebrow="Bắt đầu từ một gian bếp" title="Khám phá theo ẩm thực" text="Lướt qua những hương vị quen và lạ. Khi thấy đúng gu, để Bếp tìm quán cho bạn." /><Stagger className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{cuisineCards.map((card) => <StaggerItem key={card.title} className="relative"><PromptCard card={card} /><span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/45 px-2 py-1 text-[10px] text-white backdrop-blur-sm">{countFor(card.title) ? `${countFor(card.title)} quán` : ""}</span></StaggerItem>)}</Stagger></section>
    <section className="pt-16"><SectionHeading eyebrow="Khi chưa biết gọi gì" title="Chọn theo tâm trạng" text="Một chút ấm áp, một chút cay, hay chỉ là muốn được chiều chuộng — bắt đầu từ cảm giác." /><Stagger className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{moodCards.map((card) => <StaggerItem key={card.title}><PromptCard card={card} /></StaggerItem>)}</Stagger></section>
    <section className="pt-16"><SectionHeading eyebrow="Cho những khoảnh khắc cụ thể" title="Ăn gì cho dịp này?" text="Bếp cũng hiểu những bữa ăn không chỉ dành cho chiếc bụng đói." /><Stagger className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{occasionCards.map((card) => <StaggerItem key={card.title}><PromptCard card={card} /></StaggerItem>)}</Stagger></section>
    <section className="pt-16"><div className="flex items-end justify-between gap-4"><SectionHeading eyebrow="Đang được chú ý" title="Quán nổi bật" text="Những địa điểm đang được thực khách để ý nhiều hơn." /><Link to="/" className="mb-1 hidden shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline sm:inline-flex">Hỏi Bếp để tìm thêm <ArrowRight className="h-4 w-4" /></Link></div><Stagger className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{trending.map((restaurant) => <StaggerItem key={restaurant.id}><RestaurantCard r={restaurant} /></StaggerItem>)}{trending.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">Các quán nổi bật đang được cập nhật.</div>}</Stagger></section>
    <section className="mt-16 rounded-3xl border border-primary/15 bg-primary/5 p-7 md:p-10"><div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center"><div><div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary"><CalendarDays className="h-4 w-4" /> Gợi ý theo mùa</div><h2 className="mt-2 font-display text-3xl">Cuối tuần này ăn gì?</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Hỏi Bếp về brunch, món ngày mưa, đồ uống mùa hè hoặc bất kỳ cảm hứng theo mùa nào bạn đang nghĩ tới.</p></div><Link to={`/?prompt=${encodeURIComponent("Gợi ý những địa điểm phù hợp cho cuối tuần này, gần tôi.")}`} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90">Gợi ý cho tôi <ArrowRight className="h-4 w-4" /></Link></div>    </section>
  </main>;
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div><div className="text-xs uppercase tracking-[.18em] text-primary">{eyebrow}</div><h2 className="mt-2 font-display text-3xl md:text-4xl">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{text}</p></div>; }
function ProfilePage() {
  const { user } = useAuth();
  const emptyAi = { favoriteFoodSlugs: [], favoriteCuisineSlugs: [], tastePreferences: [], dietaryPreferences: [], diningStyles: [], restaurantFeatures: [], memories: [] };
  const [preferences, setPreferences] = useState<UserPreferences>({ favoriteCategorySlugs: [], dietaryPreferences: [], preferredPriceLevels: [], aiPreferences: emptyAi });
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!user) return; void getPreferences().then((saved) => setPreferences({ ...saved, aiPreferences: { ...emptyAi, ...saved.aiPreferences, dietaryPreferences: saved.aiPreferences?.dietaryPreferences ?? saved.dietaryPreferences, memories: saved.aiPreferences?.memories ?? [] } })).catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải hồ sơ AI.")).finally(() => setBusy(false)); }, [user]);
  if (!user) return <main className="container-page py-20"><h1 className="font-display text-4xl">Bạn chưa đăng nhập</h1><Link className="mt-5 inline-block text-primary" to="/auth">Đăng nhập</Link></main>;
  const ai = { ...emptyAi, ...preferences.aiPreferences, memories: preferences.aiPreferences?.memories ?? [] };
  const updateAi = (patch: Record<string, unknown>) => setPreferences((current) => ({ ...current, aiPreferences: { ...emptyAi, ...current.aiPreferences, ...patch } }));
  const toggle = (key: string, value: string) => { const values = (ai[key as keyof typeof ai] as string[] | undefined) ?? []; updateAi({ [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] }); };
  const save = async () => { setSaving(true); setNotice(""); setError(""); try { const saved = await updatePreferences({ ...preferences, favoriteCategorySlugs: ai.favoriteFoodSlugs, dietaryPreferences: ai.dietaryPreferences, aiPreferences: ai }); setPreferences(saved); setNotice("Đã lưu. Từ giờ Hỏi Bếp sẽ nhớ những điều này khi gợi ý cho bạn."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu hồ sơ AI."); } finally { setSaving(false); } };
  const clearPreferences = () => setPreferences({ favoriteCategorySlugs: [], dietaryPreferences: [], preferredPriceLevels: [], aiPreferences: emptyAi });
  const foods: Array<[string, string]> = [["pho", "Phở"], ["bun", "Bún"], ["pizza", "Pizza"], ["sushi", "Sushi"], ["bbq", "BBQ"], ["seafood", "Hải sản"], ["hotpot", "Lẩu"], ["coffee", "Cà phê"], ["dessert", "Tráng miệng"], ["vegetarian", "Món chay"]];
  const cuisines: Array<[string, string]> = [["vietnamese", "Việt Nam"], ["japanese", "Nhật Bản"], ["korean", "Hàn Quốc"], ["chinese", "Trung Hoa"], ["thai", "Thái Lan"], ["italian", "Ý"], ["american", "Mỹ"], ["indian", "Ấn Độ"]];
  const tastes: Array<[string, string]> = [["spicy", "Cay"], ["mild", "Thanh nhẹ"], ["sweet", "Ngọt"], ["sour", "Chua"], ["salty", "Mặn"], ["rich", "Đậm đà"], ["light", "Nhẹ vị"]];
  const diets: Array<[string, string]> = [["vegetarian", "Ăn chay"], ["vegan", "Thuần chay"], ["healthy", "Lành mạnh"], ["keto", "Keto"], ["low-carb", "Ít tinh bột"], ["gluten-free", "Không gluten"], ["halal", "Halal"]];
  const styles: Array<[string, string]> = [["solo", "Ăn một mình"], ["couple", "Hẹn hò"], ["friends", "Bạn bè"], ["family", "Gia đình"], ["business", "Công việc"]];
  const features: Array<[string, string]> = [["wifi", "Wi-Fi"], ["ac", "Điều hòa"], ["outdoor", "Ngoài trời"], ["parking", "Chỗ đỗ xe"], ["private", "Phòng riêng"], ["pet", "Pet friendly"]];
  const memories = [...(ai.memories ?? []).map((memory) => memory.text), ...((ai.favoriteFoodSlugs ?? []).slice(0, 2).map((value) => `Thường thích ${foods.find(([key]) => key === value)?.[1] ?? value}`)), ...(ai.budget && ai.budget !== "any" ? [`Ngân sách ${ai.budget.replace("-", "–")}k`] : []), ...(ai.searchRadius && ai.searchRadius !== "any" ? [`Thường tìm trong ${ai.searchRadius} km`] : [])];
  return <main className="container-page min-h-[70vh] py-10 pb-24 md:py-14"><div className="max-w-4xl"><div className="flex flex-wrap items-end justify-between gap-5"><div><div className="text-xs font-bold uppercase tracking-[.18em] text-primary">AI PREFERENCE CENTER</div><h1 className="mt-3 font-display text-5xl leading-tight">Dạy Bếp hiểu bạn hơn.</h1><p className="mt-3 max-w-2xl text-muted-foreground">Mỗi lựa chọn giúp Hỏi Bếp gợi ý tự nhiên hơn, ngắn hơn và đúng gu hơn.</p></div><button onClick={() => { void signOut().finally(() => { window.location.href = "/"; }); }} className="rounded-full border border-border px-5 py-2 text-sm hover:border-destructive hover:text-destructive">Đăng xuất</button></div>{busy ? <p className="mt-10 text-sm text-muted-foreground">Đang tải hồ sơ AI…</p> : <div className="mt-10 space-y-5"><section className="rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8"><SectionTitle eyebrow="01 · Tài khoản" title="Thông tin của bạn" text="Quản lý tài khoản cơ bản." /><div className="mt-6 flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 font-display text-2xl text-primary">{(user.displayName || user.email)[0].toUpperCase()}</div><div><div className="font-medium">{user.displayName || "Chưa đặt tên"}</div><div className="text-sm text-muted-foreground">{user.email}</div><div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Đăng nhập bằng email</div></div></div></section><section className="rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8"><SectionTitle eyebrow="02 · Taste profile" title="Hồ sơ vị giác" text="Bếp dùng các lựa chọn này làm ngữ cảnh mặc định khi bạn hỏi nên ăn gì." /><PreferenceGroup title="Món bạn thích" options={foods} selected={ai.favoriteFoodSlugs ?? []} onToggle={(value) => toggle("favoriteFoodSlugs", value)} /><PreferenceGroup title="Gian bếp yêu thích" options={cuisines} selected={ai.favoriteCuisineSlugs ?? []} onToggle={(value) => toggle("favoriteCuisineSlugs", value)} /><PreferenceGroup title="Khẩu vị" options={tastes} selected={ai.tastePreferences ?? []} onToggle={(value) => toggle("tastePreferences", value)} /><PreferenceGroup title="Chế độ ăn" options={diets} selected={ai.dietaryPreferences ?? []} onToggle={(value) => toggle("dietaryPreferences", value)} /></section><section className="rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8"><SectionTitle eyebrow="03 · Dining preferences" title="Bạn thường ăn như thế nào?" text="Bếp sẽ ưu tiên quán phù hợp với hoàn cảnh và giới hạn của bạn." /><ChoiceRow title="Bán kính mặc định" options={[["2", "2 km"], ["5", "5 km"], ["10", "10 km"], ["any", "Mọi nơi"]]} selected={ai.searchRadius} onSelect={(value) => updateAi({ searchRadius: value })} /><ChoiceRow title="Ngân sách" options={[["under-100", "Dưới 100k"], ["100-200", "100–200k"], ["200-500", "200–500k"], ["any", "Không giới hạn"]]} selected={ai.budget} onSelect={(value) => updateAi({ budget: value })} /><PreferenceGroup title="Đi cùng ai" options={styles} selected={ai.diningStyles ?? []} onToggle={(value) => toggle("diningStyles", value)} /><PreferenceGroup title="Tiện ích mong muốn" options={features} selected={ai.restaurantFeatures ?? []} onToggle={(value) => toggle("restaurantFeatures", value)} /></section><section className="rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8"><SectionTitle eyebrow="04 · AI recommendation preferences" title="Hỏi Bếp nên gợi ý thế nào?" text="Kiểm soát cách Bếp cân bằng giữa khám phá và sự phù hợp." /><ChoiceRow title="Phong cách gợi ý" options={[["popular", "Quán nổi tiếng"], ["hidden-gems", "Quán ẩn mình"], ["new", "Mới mở"], ["local", "Gu địa phương"]]} selected={ai.recommendationStyle} onSelect={(value) => updateAi({ recommendationStyle: value })} /><ChoiceRow title="Ưu tiên" options={[["distance", "Khoảng cách"], ["quality", "Chất lượng món"], ["rating", "Đánh giá"], ["price", "Giá"], ["atmosphere", "Không khí"]]} selected={ai.recommendationPriority} onSelect={(value) => updateAi({ recommendationPriority: value })} /><ChoiceRow title="Số lượng gợi ý" options={[["few", "Ít nhưng đúng"], ["balanced", "Cân bằng"], ["many", "Nhiều lựa chọn"]]} selected={ai.suggestionCount} onSelect={(value) => updateAi({ suggestionCount: value })} /></section><section className="rounded-3xl border border-primary/15 bg-primary/5 p-6 md:p-8"><SectionTitle eyebrow="05 · AI memory" title="Bếp đang nhớ gì về bạn?" text="Bạn luôn có thể chỉnh sửa hoặc xóa những điều này." />{memories.length ? <div className="mt-5 space-y-2">{memories.map((memory, index) => <div key={`${memory}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-background/70 px-4 py-3 text-sm"><span>✦ {memory}</span>{index < (ai.memories ?? []).length && <button onClick={() => updateAi({ memories: (ai.memories ?? []).filter((_, memoryIndex) => memoryIndex !== index) })} className="text-xs text-muted-foreground hover:text-destructive">Xóa</button>}</div>)}</div> : <div className="mt-5 rounded-2xl border border-dashed border-primary/25 p-5 text-sm text-muted-foreground">Giúp Bếp hiểu khẩu vị của bạn. Chọn vài sở thích để những lần hỏi sau trở nên thông minh hơn.</div>}<button onClick={clearPreferences} className="mt-5 text-xs text-muted-foreground hover:text-destructive">Xóa tất cả bộ nhớ</button></section>{error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="rounded-xl border border-basil/30 bg-basil/10 px-3 py-2 text-sm text-basil">✓ {notice}</p>}<button onClick={() => void save()} disabled={saving} className="sticky bottom-4 z-10 w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-white shadow-lift disabled:opacity-50">{saving ? "Đang lưu hồ sơ AI…" : "Lưu hồ sơ & dạy Bếp nhớ"}</button></div>}</div></main>;
}

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-primary">{eyebrow}</div><h2 className="mt-2 font-display text-2xl md:text-3xl">{title}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{text}</p></div>; }
function ChoiceRow({ title, options, selected, onSelect }: { title: string; options: Array<[string, string]>; selected?: string; onSelect: (value: string) => void }) { return <div className="mt-7"><div className="text-sm font-medium">{title}</div><div className="mt-3 flex flex-wrap gap-2">{options.map(([value, label]) => <button key={value} onClick={() => onSelect(value)} className={`rounded-full border px-3.5 py-2 text-xs transition-colors ${selected === value ? "border-primary bg-primary text-white" : "border-border hover:border-primary/60"}`}>{label}</button>)}</div></div>; }

function PreferenceGroup({ title, hint, options, selected, onToggle }: { title: string; hint?: string; options: Array<[string, string]>; selected: string[]; onToggle: (value: string) => void }) { return <div className="mt-7"><div className="text-sm font-medium">{title}</div>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{options.map(([value, label]) => <button key={value} onClick={() => onToggle(value)} className={`rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${selected.includes(value) ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/60"}`}><span className={`mr-2 inline-block h-2 w-2 rounded-full ${selected.includes(value) ? "bg-primary" : "bg-border"}`} />{label}</button>)}</div></div>; }
function NotFound() { return <main className="container-page py-20"><h1 className="font-display text-4xl">Không tìm thấy trang</h1><Link className="mt-5 inline-block text-primary" to="/">Về trang chủ</Link></main>; }

function DbHomePage() {
  const [query, setQuery] = useState(() => new URLSearchParams(useLocation().search).get("q") ?? "");
  const [items, setItems] = useState<Restaurant[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(true); void (query.trim() ? searchRestaurants(query.trim()) : listRestaurants()).then(setItems).catch(() => setItems([])).finally(() => setBusy(false)); }, [query]);
  return <main className="container-page flex w-full flex-1 flex-col pb-24 md:pb-6"><div className="mx-auto w-full max-w-4xl py-12"><img className="h-14 w-14 object-contain" src="/bep-mark.png" alt="" /><h1 className="mt-6 max-w-lg text-balance font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">Khám phá quán ăn <em className="italic text-primary">thật</em>.</h1><p className="mt-4 max-w-md text-muted-foreground">Dữ liệu được lấy trực tiếp của Bếp.</p><form className="prompt-input-group mt-8" onSubmit={(event) => event.preventDefault()}><textarea value={query} onChange={(event) => setQuery(event.target.value)} className="prompt-input-textarea" placeholder="Tìm phở, cà phê, quận…" /><div className="flex items-center justify-between px-3 pb-3 text-xs text-muted-foreground"><span>{busy ? "Đang tải dữ liệu…" : `${items.length} quán`}</span><button className="rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground">Tìm</button></div></form><div className="mt-10 grid gap-4 md:grid-cols-2">{items.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>{!busy && items.length === 0 && <p className="mt-8 text-sm text-muted-foreground">Chưa có dữ liệu phù hợp hoặc backend chưa chạy.</p>}</div></main>;
}

function DbDiscoverPage() {
  const [items, setItems] = useState<Restaurant[]>([]);
  useEffect(() => { void listRestaurants().then(setItems).catch(() => setItems([])); }, []);
  return <><section className="container-page pt-10 md:pt-14"><h1 className="mt-2 max-w-2xl text-balance font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">Những quán đang có trong <em className="italic text-primary">database</em>.</h1></section><section className="container-page py-12 md:py-16"><div className="grid gap-4 md:grid-cols-2">{items.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>{items.length === 0 && <p className="text-sm text-muted-foreground">Backend chưa trả về nhà hàng.</p>}</section><Footer /></>;
}

function DbSearchPage() {
  const query = new URLSearchParams(useLocation().search).get("q") ?? "";
  const [items, setItems] = useState<Restaurant[]>([]);
  useEffect(() => { void searchRestaurants(query).then(setItems).catch(() => setItems([])); }, [query]);
  return <main className="container-page py-12 pb-24"><h1 className="font-display text-4xl">Tìm kiếm</h1><p className="mt-2 text-muted-foreground">Kết quả thật cho “{query}”</p><div className="mt-8 grid gap-4 md:grid-cols-2">{items.map((restaurant) => <RestaurantCard key={restaurant.id} r={restaurant} />)}</div>{items.length === 0 && <p className="mt-8 text-sm text-muted-foreground">Không tìm thấy quán phù hợp.</p>}</main>;
}

function RestaurantDetailPage() {
  const id = useLocation().pathname.split("/").filter(Boolean).pop() ?? "";
  const [detail, setDetail] = useState<BackendRestaurantDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [related, setRelated] = useState<Restaurant[]>([]);
  const relatedCarouselRef = useRef<HTMLDivElement>(null);
  const moveRelated = (direction: -1 | 1) => { relatedCarouselRef.current?.scrollBy({ left: direction * Math.max(280, relatedCarouselRef.current.clientWidth * 0.82), behavior: "smooth" }); };
  useEffect(() => { let cancelled = false; setDetail(null); setFailed(false); void getRestaurant(id).then((value) => { if (!cancelled) setDetail(value); }).catch(() => { if (!cancelled) setFailed(true); }); return () => { cancelled = true; }; }, [id]);
  useEffect(() => { if (!detail) return; let cancelled = false; void getSimilarRestaurants(id, 12).then((items) => { if (!cancelled) setRelated(items); }).catch(() => { if (!cancelled) setRelated([]); }); return () => { cancelled = true; }; }, [detail, id]);
  if (failed) return <main className="container-page py-20"><p className="text-muted-foreground">Không thể tải thông tin quán.</p><Link to="/discover" className="mt-4 inline-block text-primary hover:underline">← Quay lại khám phá</Link></main>;
  if (!detail) return <main className="container-page py-20"><p className="text-muted-foreground">Đang tải thông tin quán…</p></main>;
  const restaurant = detailToRestaurant(detail);
  return <main className="container-page py-10 pb-24 md:pb-16"><Reveal><Link to="/discover" className="text-sm text-muted-foreground hover:text-foreground">← Quay lại khám phá</Link><div className="mt-6 grid gap-8 md:grid-cols-[1.1fr,1fr]">{restaurant.image ? <img src={restaurant.image} alt={restaurant.name} className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift" /> : <img src="/no-photo.svg" alt="Chưa có ảnh" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift" />}<div><div className="text-xs uppercase tracking-widest text-muted-foreground">{restaurant.cuisine.join(" · ")}</div><div className="mt-2 flex items-start justify-between gap-4"><h1 className="font-display text-4xl md:text-5xl">{restaurant.name}</h1><SaveRestaurantButton restaurantId={restaurant.id} size="large" /></div><div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">{restaurant.rating != null && restaurant.rating > 0 && <span><Star className="mr-1 inline h-4 w-4 fill-primary text-primary" />{restaurant.rating}{restaurant.reviews != null && restaurant.reviews > 0 && ` (${restaurant.reviews.toLocaleString()})`}</span>}<span><MapPin className="mr-1 inline h-4 w-4" />{restaurant.area}</span>{restaurant.hours && <span><Clock className="mr-1 inline h-4 w-4" />{restaurant.hours}</span>}</div>{restaurant.description && <p className="mt-6 text-muted-foreground">{restaurant.description}</p>}<div className="mt-6"><a href={restaurant.sourceUrl ?? undefined} target="_blank" rel="noreferrer" className={`inline-flex rounded-full border border-border px-4 py-2 text-sm ${restaurant.sourceUrl ? "hover:border-primary hover:text-primary" : "pointer-events-none text-muted-foreground"}`}>{restaurant.sourceUrl ? "Mở trong Google Maps ↗" : "Nguồn Google Maps chưa rõ"}</a></div>{(detail.phone || detail.websiteUrl) && <div className="mt-3 flex flex-wrap gap-3 text-sm">{detail.phone && <a href={`tel:${detail.phone}`} className="rounded-full border border-border px-4 py-2 hover:border-primary hover:text-primary">{detail.phone}</a>}{detail.websiteUrl && <a href={detail.websiteUrl} target="_blank" rel="noreferrer" className="rounded-full border border-border px-4 py-2 hover:border-primary hover:text-primary">Website ↗</a>}</div>}</div></div><section className="mt-12"><div className="flex items-end justify-between gap-3"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Từ menu của quán</div><h2 className="mt-1 font-display text-3xl">Món nên thử</h2></div><span className="text-xs text-muted-foreground">Bấm món để xem detail</span></div>{detail.dishes.length ? <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">{detail.dishes.map((dish) => <DishCard key={dish.id} dish={toDish(dish, detail)} />)}</div> : <p className="mt-4 text-sm text-muted-foreground">Quán chưa có món được cập nhật.</p>}</section>{related.length > 0 && <section className="mt-14"><div className="flex items-end justify-between gap-4"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Có thể bạn cũng thích</div><h2 className="mt-1 font-display text-3xl">Quán tương tự</h2></div><div className="flex gap-2"><button type="button" aria-label="Quán tương tự trước" onClick={() => moveRelated(-1)} className="rounded-full border border-border bg-card p-2 transition-colors hover:border-primary hover:text-primary"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Quán tương tự tiếp theo" onClick={() => moveRelated(1)} className="rounded-full border border-border bg-card p-2 transition-colors hover:border-primary hover:text-primary"><ChevronRight className="h-4 w-4" /></button></div></div><div ref={relatedCarouselRef} style={{ touchAction: "pan-x" }} className="mt-6 flex cursor-grab select-none snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-1 pb-3 active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{related.slice(0, 12).map((item) => <div key={item.id} className="w-[min(82vw,360px)] shrink-0 snap-start sm:w-[360px]"><RestaurantCard r={item} /></div>)}</div></section>}{detail.reviews.length > 0 && <section className="mt-12"><h2 className="font-display text-3xl">Thực khách nói gì</h2><div className="mt-6 grid gap-3 md:grid-cols-2">{detail.reviews.slice(0, 6).map((review) => <article key={review.id} className="rounded-2xl border border-border bg-card p-4">{review.rating != null && review.rating > 0 && <div className="text-sm"><Star className="mr-1 inline h-4 w-4 fill-primary text-primary" />{review.rating}</div>}{review.content && <p className="mt-2 text-sm leading-6 text-muted-foreground">{review.content}</p>}</article>)}</div></section>}</Reveal></main>;
}

function DishDetailPage() {
  const id = useLocation().pathname.split("/").filter(Boolean).pop() ?? "";
  const [dish, setDish] = useState<BackendDish | null>(null);
  const [restaurant, setRestaurant] = useState<BackendRestaurantDetail | null>(null);
  const [servingRestaurants, setServingRestaurants] = useState<Restaurant[]>([]);
  const [similarDishes, setSimilarDishes] = useState<Dish[]>([]);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setDish(null); setRestaurant(null); setServingRestaurants([]); setSimilarDishes([]); setFailed(false);
    void getDish(id).then(async (found) => {
      if (!found) throw new Error("missing");
      const [restaurantDetail, restaurantMatches, dishMatches] = await Promise.all([
        getRestaurant(found.restaurantId),
        searchRestaurants(found.name, { sort: "relevance" }).catch(() => []),
        listDishes(20, found.name).catch(() => []),
      ]);
      if (cancelled) return;
      setDish(found);
      setRestaurant(restaurantDetail);
      setServingRestaurants([
        ...restaurantMatches.filter((item) => item.id !== found.restaurantId),
        detailToRestaurant(restaurantDetail),
      ].slice(0, 6));
      setSimilarDishes(dishMatches.filter((item) => item.id !== found.id).slice(0, 4).map((item) => toDiscoverDish(item)));
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [id]);
  if (failed) return <main className="container-page py-20"><p className="text-muted-foreground">Không thể tải thông tin món.</p><Link to="/discover" className="mt-4 inline-block text-primary hover:underline">← Quay lại khám phá</Link></main>;
  if (!dish || !restaurant) return <main className="container-page py-20"><p className="text-muted-foreground">Đang tải thông tin món…</p></main>;
  const dishView = toDiscoverDish(dish);
  const share = async () => { try { await navigator.clipboard?.writeText(window.location.href); } finally { setShared(true); window.setTimeout(() => setShared(false), 1800); } };
  return <main className="min-h-screen pb-24">
    <Reveal><div className="container-page pt-6"><Link to="/search" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /> Về khám phá</Link></div>
    <section className="container-page mt-6 grid gap-12 md:grid-cols-[1.1fr_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-3xl bg-card shadow-lift"><div className="aspect-square overflow-hidden"><img src={dishView.image} alt={dish.name} className="h-full w-full object-cover" /></div></div>
      <div className="flex flex-col justify-center">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground"><span>{dish.category ?? "Món ăn"}</span><span className="opacity-40">·</span><span>{restaurant.name}</span></div>
        <h1 className="mt-2 font-display text-5xl md:text-6xl">{dish.name}</h1>
        {dish.description && <p className="mt-1 text-lg italic text-muted-foreground">{dish.description}</p>}
<div className="mt-5 flex flex-wrap items-center gap-4 text-sm">{dish.isPopular && <span className="inline-flex items-center gap-1.5"><Star className="h-4 w-4 fill-primary text-primary" /><span className="font-medium">Popular</span></span>}{dish.priceAmount != null && dish.priceAmount > 0 && <span className="font-medium">{dish.priceAmount.toLocaleString("vi-VN")}₫</span>}</div>
        <p className="mt-6 text-lg leading-relaxed text-foreground/80">{dish.description ?? "Món này chưa có mô tả chi tiết."}</p>
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4"><div><div className="text-[11px] uppercase tracking-widest text-muted-foreground">Tastes like</div><div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="mustard">{dish.category ?? "Món ăn"}</Badge>{dish.isPopular && <Badge variant="mustard">phổ biến</Badge>}</div></div><div><div className="text-[11px] uppercase tracking-widest text-muted-foreground">Made with</div><div className="mt-2 text-sm text-foreground/80">{dish.description ? "Nguyên liệu theo mô tả của quán" : restaurant.name}</div></div></div>
        <div className="mt-8 flex flex-wrap gap-3"><Button asChild><a href="#where">Where to eat this →</a></Button><Button type="button" variant="outline" onClick={() => setSaved((value) => !value)}><Bookmark className={saved ? "fill-current" : ""} /> {saved ? "Saved" : "Save"}</Button><Button type="button" variant="outline" onClick={() => void share()}><Share2 /> {shared ? "Copied" : "Share"}</Button></div>
      </div>
    </section></Reveal>
    <section id="where" className="container-page mt-24"><div className="flex items-end justify-between gap-6"><div><div className="text-xs uppercase tracking-widest text-muted-foreground">Where to eat this</div><h2 className="mt-2 font-display text-3xl md:text-4xl">{servingRestaurants.length} places serving {dish.name}</h2></div><span className="text-sm text-muted-foreground">Sorted by relevance</span></div><Stagger className="mt-8 grid gap-4 md:grid-cols-2">{servingRestaurants.map((item) => <StaggerItem key={item.id}><RestaurantCard r={item} /></StaggerItem>)}</Stagger></section>
    {similarDishes.length > 0 && <section className="container-page mt-24 border-t border-border pt-16"><h2 className="font-display text-3xl md:text-4xl">If you like this, you might like</h2><Stagger className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">{similarDishes.map((item) => <StaggerItem key={item.id}><DishCard dish={item} /></StaggerItem>)}</Stagger></section>}
  </main>;
}

const router = createBrowserRouter([{ path: "/auth", element: <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</main>}><AuthPage /></Suspense> }, { path: "/", element: <AskPage /> }, { path: "/discover", element: <><Header /><DiscoverPage /></> }, { path: "/map", element: <Suspense fallback={<main className="container-page py-20 text-sm text-muted-foreground">Đang tải bản đồ…</main>}><SourceMapPage /><Footer /></Suspense> }, { path: "/saved", element: <><Header /><SavedPage /><Footer /></> }, { path: "/search", element: <><Header /><ExplorePage /><Footer /></> }, { path: "/dishes/:id", element: <><Header /><DishDetailPage /><Footer /></> }, { path: "/restaurants/:id", element: <><Header /><RestaurantDetailPage /><Footer /></> }, { path: "/profile", element: <><Header /><ProfilePage /><Footer /></> }, { path: "*", element: <><Header /><NotFound /><Footer /></> }]);
export function App() { return <RouterProvider router={router} />; }
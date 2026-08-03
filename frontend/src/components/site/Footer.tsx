import { Link } from "react-router-dom";

type FooterLink = { label: string; to: string };

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-parchment/60">
      <div className="container-page grid gap-10 py-14 md:grid-cols-4">
        <div>
          <div className="font-display text-2xl">Bếp<span className="text-primary">.</span></div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            A food discovery platform that starts with what you feel like eating — and finds the right table for it.
          </p>
        </div>
        {[
          { title: "Khám phá", items: [{ label: "Tìm món và quán", to: "/search" }, { label: "Đang được yêu thích", to: "/discover" }, { label: "Hỏi Bếp theo tâm trạng", to: "/" }, { label: "Bản đồ xung quanh bạn", to: "/map" }] },
          { title: "Dành cho bạn", items: [{ label: "Quán đã lưu", to: "/saved" }, { label: "Hồ sơ khẩu vị", to: "/profile" }, { label: "Đăng nhập / đăng ký", to: "/auth" }] },
          { title: "Bếp", items: [{ label: "Về trang chủ", to: "/" }, { label: "Dữ liệu địa điểm", to: "/discover" }, { label: "Liên hệ", to: "mailto:hello@bep.food" }] },
        ].map((col) => (
          <div key={col.title}>
            <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{col.title}</div>
            <ul className="mt-4 space-y-2 text-sm">
              {col.items.map((item: FooterLink) => (
                <li key={item.label}>
                  {item.to.startsWith("mailto:") ? <a href={item.to} className="text-foreground/80 transition-colors hover:text-primary">{item.label}</a> : <Link to={item.to} className="text-foreground/80 transition-colors hover:text-primary">{item.label}</Link>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <div>© {new Date().getFullYear()} Bếp — nền tảng khám phá món ăn.</div>
          <div className="flex gap-4"><span>Dữ liệu dùng cho mục đích khám phá</span><a href="mailto:hello@bep.food" className="hover:text-foreground">Liên hệ</a></div>
        </div>
      </div>
    </footer>
  );
}

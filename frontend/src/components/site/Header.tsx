import { MessageCircle, Compass, Map, Bookmark, User } from "lucide-react";
import mark from "@/assets/bep-mark.png";
import { useAuth } from "@/hooks/useAuth";
import { Link, NavLink } from "react-router-dom";

const nav = [
  { to: "/", label: "Hỏi Bếp", icon: MessageCircle },
  { to: "/discover", label: "Khám phá", icon: Compass },
  { to: "/map", label: "Bản đồ", icon: Map },
  { to: "/saved", label: "Đã lưu", icon: Bookmark },
] as const;

export function Header() {
  const { user } = useAuth();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="container-page flex h-16 items-center gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img src={mark} alt="" width={512} height={512} className="h-8 w-8 object-contain" />
            <span className="font-display text-xl font-semibold tracking-tight">
              Bếp<span className="text-primary">.</span>
            </span>
          </Link>

          <nav aria-label="Điều hướng chính" className="ml-2 hidden items-center gap-1 text-sm md:flex">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `rounded-full px-3 py-2 text-muted-foreground transition-colors hover:text-foreground ${isActive ? "bg-muted text-foreground" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Link
                to="/profile"
                className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-sm font-medium uppercase"
                aria-label="Trang cá nhân"
              >
                {(user.email ?? "?").charAt(0)}
              </Link>
            ) : (
              <Link
                to="/auth"
                className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      </header>

      <BottomNav />
    </>
  );
}

function BottomNav() {
  const items = [...nav, { to: "/profile", label: "Tôi", icon: User }] as const;
  return (
    <nav aria-label="Điều hướng trên thiết bị di động" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur-md md:hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] ${isActive ? "text-primary" : "text-muted-foreground"}`}
        >
          <item.icon aria-hidden="true" className="h-5 w-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

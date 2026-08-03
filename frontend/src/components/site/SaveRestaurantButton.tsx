import { Bookmark } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { loadSavedStatus, removeSavedRestaurant, saveRestaurant, setCachedSavedStatus } from "@/lib/api";

export function SaveRestaurantButton({ restaurantId, size = "default", initialSaved }: { restaurantId: string; size?: "default" | "large" | "compact"; initialSaved?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (initialSaved !== undefined) {
      setSaved(initialSaved);
      return () => { cancelled = true; };
    }
    if (!user?.id) {
      setSaved(false);
      return () => { cancelled = true; };
    }
    void loadSavedStatus(user.id, restaurantId)
      .then((value) => { if (!cancelled) setSaved(value); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [initialSaved, restaurantId, user?.id]);

  const toggle = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!user?.id) {
      navigate(`/auth?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const nextSaved = !saved;
      if (nextSaved) await saveRestaurant(restaurantId);
      else await removeSavedRestaurant(restaurantId);
      setCachedSavedStatus(user.id, restaurantId, nextSaved);
      setSaved(nextSaved);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const label = error ? "Không thể cập nhật trạng thái lưu" : saved ? "Bỏ lưu quán" : "Lưu quán";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={loading}
      onClick={toggle}
      className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm text-foreground transition-colors disabled:cursor-wait disabled:opacity-60 ${saved ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/60 hover:text-primary"} ${size === "large" ? "px-5 py-2.5" : ""} ${size === "compact" ? "h-7 min-h-7 w-7 min-w-7 shrink-0 gap-0 p-1.5" : ""}`}
    >
      <Bookmark aria-hidden="true" className={`${size === "compact" ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} ${saved ? "fill-current" : ""}`} />
      {size !== "compact" && (loading ? "Đang lưu…" : saved ? "Đã lưu" : "Lưu quán")}
    </button>
  );
}
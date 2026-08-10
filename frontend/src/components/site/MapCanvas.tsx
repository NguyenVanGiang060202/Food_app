import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Restaurant } from '@/lib/food-data';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, MapPin, Star } from 'lucide-react';
import { EASE_IN_OUT, EASE_OUT } from '@/lib/motion';
import { SmartImage } from './SmartImage';

const HO_CHI_MINH_CENTER: L.LatLngTuple = [10.8231, 106.6297];
const HO_CHI_MINH_BOUNDS = L.latLngBounds([10.55, 106.25], [11.25, 107.05]);

export function MapCanvas({
  ids = [],
  restaurants = [],
  activeId,
  onHover,
  labels,
  userLocation,
  onLocate,
  locateTrigger,
}: {
  ids?: string[];
  restaurants?: Restaurant[];
  activeId: string | null;
  onHover: (id: string | null) => void;
  labels?: Record<string, string>;
  userLocation?: [number, number] | null;
  onLocate?: () => void;
  locateTrigger?: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markers = useRef<L.Marker[]>([]);
  const userMarker = useRef<L.CircleMarker | null>(null);
  const lastUserKeyRef = useRef<string | null>(null);
  const locateRequestedRef = useRef(false);
  const onHoverRef = useRef(onHover);
  const reduced = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [sized, setSized] = useState(false);

  useEffect(() => {
    if (locateTrigger != null) {
      lastUserKeyRef.current = null;
      locateRequestedRef.current = true;
    }
  }, [locateTrigger]);
  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);
  useEffect(() => {
    setCollapsed(false);
  }, [activeId]);
  const items = useMemo(
    () =>
      restaurants.length
        ? restaurants
        : ids.map(
            (id) =>
              ({
                id,
                name: labels?.[id] ?? id,
                area: '',
                cuisine: [],
                rating: null,
                reviews: null,
                distanceKm: null,
                price: null,
                open: null,
                hours: null,
                image: null,
                sourceUrl: null,
                description: null,
                dishIds: [],
              }) as Restaurant,
          ),
    [ids, labels, restaurants],
  );
  const locatedItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.latitude != null &&
          item.longitude != null &&
          HO_CHI_MINH_BOUNDS.contains([item.latitude, item.longitude]),
      ),
    [items],
  );
  useEffect(() => {
    const container = mapRef.current;
    if (!container || mapInstance.current) return;
    const map = L.map(container, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: HO_CHI_MINH_BOUNDS,
      maxBoundsViscosity: 0.9,
    }).setView(HO_CHI_MINH_CENTER, 12);
    map.on('click', () => onHoverRef.current(null));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);
    mapInstance.current = map;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const visible = container.clientWidth > 0 && container.clientHeight > 0;
      if (visible) map.invalidateSize();
      setSized(visible);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => {
      disposed = true;
      observer.disconnect();
      map.remove();
      mapInstance.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !sized) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    locatedItems.forEach((item) => {
      const marker = L.marker([item.latitude!, item.longitude!], {
        title: item.name,
        restaurantId: item.id,
        icon: L.divIcon({
          className: 'bep-map-marker-shell',
          html: '<span class="bep-map-marker"><span class="bep-map-marker-core"></span></span>',
          iconSize: [30, 36],
          iconAnchor: [15, 36],
          popupAnchor: [0, -34],
        }),
      } as L.MarkerOptions & { restaurantId: string }).addTo(map);
      marker.bindTooltip(item.name, { direction: 'top', offset: [0, -12] });
      marker.on('mouseover', () => {
        onHoverRef.current(item.id);
      });
      marker.on('click', () => {
        onHoverRef.current(item.id);
      });
      markers.current.push(marker);
    });
  }, [locatedItems, sized]);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !sized) return;
    userMarker.current?.remove();
    userMarker.current = userLocation
      ? L.circleMarker(userLocation, {
          radius: 8,
          color: '#2563eb',
          fillColor: '#60a5fa',
          fillOpacity: 0.9,
          weight: 3,
        })
          .addTo(map)
          .bindTooltip('Vị trí của bạn', { direction: 'top' })
      : null;
    if (userLocation) {
      const userKey = `${userLocation[0].toFixed(5)},${userLocation[1].toFixed(5)}`;
      const wasLocateRequested = locateRequestedRef.current;
      if (userKey !== lastUserKeyRef.current || wasLocateRequested) {
        lastUserKeyRef.current = userKey;
        locateRequestedRef.current = false;
        const duration = wasLocateRequested ? 0 : 0.3;
        if (locatedItems.length > 0) {
          const points: L.LatLngExpression[] = [userLocation];
          locatedItems.forEach((item) =>
            points.push([item.latitude!, item.longitude!] as L.LatLngTuple),
          );
          const bounds = L.latLngBounds(points);
          const tooWide = bounds.getSouthWest().distanceTo(bounds.getNorthEast()) > 8000;
          if (tooWide) map.flyTo(userLocation, 14, { duration });
          else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
        } else {
          map.flyTo(userLocation, 14, { duration });
        }
      }
    } else if (locatedItems.length === 1) {
      lastUserKeyRef.current = null;
      map.setView([locatedItems[0].latitude!, locatedItems[0].longitude!], 16);
    } else if (locatedItems.length > 1) {
      lastUserKeyRef.current = null;
      const bounds = L.latLngBounds(
        locatedItems.map((item) => [item.latitude!, item.longitude!] as L.LatLngTuple),
      );
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    } else {
      lastUserKeyRef.current = null;
      map.setView(HO_CHI_MINH_CENTER, 12);
    }
  }, [userLocation, locatedItems, sized]);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !activeId || !sized) return;
    const marker = markers.current.find(
      (candidate) =>
        (candidate.options as L.MarkerOptions & { restaurantId?: string }).restaurantId ===
        activeId,
    );
    const item = locatedItems.find((candidate) => candidate.id === activeId);
    if (!marker || !item) return;
    marker.setZIndexOffset(1000);
    map.flyTo([item.latitude!, item.longitude!], Math.max(map.getZoom(), 16), { duration: 0.45 });
  }, [activeId, locatedItems]);
  useEffect(() => {
    markers.current.forEach((marker) => {
      const element = marker.getElement();
      const markerId = (marker.options as L.MarkerOptions & { restaurantId?: string }).restaurantId;
      if (element) {
        element.classList.toggle('bep-map-marker-is-active', markerId === activeId);
        element.classList.toggle(
          'bep-map-marker-is-muted',
          Boolean(activeId) && markerId !== activeId,
        );
      }
      marker.setZIndexOffset(markerId === activeId ? 1000 : 0);
    });
  }, [activeId]);
  const selected = items.find((item) => item.id === activeId);
  return (
    <div className="absolute inset-0">
      <style>{`.bep-map-marker-shell{background:transparent!important;border:0!important}.bep-map-marker{display:grid;place-items:center;width:30px;height:30px;border-radius:999px 999px 999px 0;background:#f97316;border:3px solid #fff;box-shadow:0 3px 10px rgba(67,20,7,.5),0 0 0 2px rgba(255,255,255,.72);transform:rotate(-45deg);transition:transform .2s,box-shadow .2s,opacity .2s,filter .2s}.bep-map-marker-core{width:9px;height:9px;border-radius:999px;background:#fff;transform:rotate(45deg);box-shadow:0 0 0 1px rgba(124,45,18,.25)}.bep-map-marker-is-active .bep-map-marker{transform:rotate(-45deg) scale(1.42);box-shadow:0 0 0 8px rgba(249,115,22,.2),0 5px 16px rgba(124,45,18,.5);animation:bep-marker-pulse 1.5s ease-in-out infinite}.bep-map-marker-is-muted{opacity:.82;filter:saturate(.9)}@keyframes bep-marker-pulse{0%,100%{box-shadow:0 0 0 5px rgba(249,115,22,.18),0 5px 16px rgba(124,45,18,.45)}50%{box-shadow:0 0 0 11px rgba(249,115,22,.04),0 5px 20px rgba(124,115,18,.55)}}@media (max-width:767px){.leaflet-control-zoom{display:none!important;visibility:hidden}}`}</style>
      <div ref={mapRef} className="h-full w-full" />
      {onLocate && (
        <button
          type="button"
          onClick={onLocate}
          aria-label="Định vị lại"
          title="Định vị lại"
          className="absolute right-3 bottom-3 z-[400] grid h-10 w-10 place-items-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm text-foreground transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2" />
          </svg>
        </button>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
            initial={reduced ? { opacity: 0 } : { y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: -24, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            className="absolute inset-x-0 top-0 z-[500] overflow-hidden rounded-b-2xl border border-primary/30 bg-card/95 shadow-lift backdrop-blur-sm md:inset-x-auto md:right-4 md:top-4 md:w-80 md:rounded-2xl"
          >
            {collapsed && (
              <div className="px-4 pb-2.5 pt-2.5">
                <span className="mx-auto block h-1 w-10 rounded-full bg-muted md:hidden" />
                <div className="mt-2 flex items-center gap-2 md:mt-0">
                  <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    aria-expanded={false}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-display text-lg">{selected.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
                      {selected.rating != null && selected.rating > 0 && (
                        <span>
                          <Star className="mr-0.5 inline h-3 w-3 fill-primary text-primary" />
                          {selected.rating}
                        </span>
                      )}
                      {selected.area && (
                        <span>
                          <MapPin className="mr-0.5 inline h-3 w-3" />
                          {selected.area}
                        </span>
                      )}
                    </div>
                  </button>
                  <motion.button
                    type="button"
                    aria-label="Mở thông tin quán"
                    onClick={() => setCollapsed(false)}
                    initial={reduced ? { opacity: 0 } : { rotate: 180, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    transition={{ duration: 0.22, ease: EASE_IN_OUT }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </motion.button>
                </div>
              </div>
            )}
            {!collapsed && (
              <div className="px-4 pt-2.5 md:hidden">
                <span className="mx-auto block h-1 w-10 rounded-full bg-muted" />
              </div>
            )}
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: EASE_IN_OUT }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border/60 px-4 pb-4 pt-3">
                    <div className="flex gap-3">
                      {selected.image ? (
                        <SmartImage
                          src={selected.image}
                          alt={selected.name}
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <img
                          src="/no-photo.svg"
                          alt="Chưa có ảnh"
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-lg">{selected.name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
                          {selected.rating != null && selected.rating > 0 && (
                            <span>
                              <Star className="mr-0.5 inline h-3 w-3 fill-primary text-primary" />
                              {selected.rating}
                            </span>
                          )}
                          {selected.distanceKm != null && (
                            <span>
                              <MapPin className="mr-0.5 inline h-3 w-3" />
                              {selected.distanceKm}km
                            </span>
                          )}
                          {selected.area && <span>{selected.area}</span>}
                        </div>
                        {selected.description && (
                          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {selected.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <a
                        href={selected.sourceUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className={`shrink-0 rounded-full border border-border px-3 py-1.5 text-xs ${selected.sourceUrl ? 'hover:border-primary hover:text-primary' : 'pointer-events-none opacity-50'}`}
                      >
                        Mở trong Google Maps
                      </a>
                      <Link
                        to={`/restaurants/${selected.id}`}
                        className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Xem chi tiết
                      </Link>
                      <motion.button
                        type="button"
                        aria-label="Thu gọn thông tin quán"
                        onClick={() => setCollapsed(true)}
                        initial={reduced ? { opacity: 0 } : { rotate: 0, opacity: 0 }}
                        animate={{ rotate: 180, opacity: 1 }}
                        transition={{ duration: 0.22, ease: EASE_IN_OUT }}
                        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      {items.length === 0 ? (
        <span className="absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-soft">
          Chưa có dữ liệu bản đồ
        </span>
      ) : locatedItems.length === 0 ? (
        <span className="absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-soft">
          Các quán chưa có tọa độ bản đồ
        </span>
      ) : null}
    </div>
  );
}

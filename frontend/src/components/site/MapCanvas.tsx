import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Restaurant } from '@/lib/food-data';
import { MapPin, Star } from 'lucide-react';
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
}: {
  ids?: string[];
  restaurants?: Restaurant[];
  activeId: string | null;
  onHover: (id: string | null) => void;
  labels?: Record<string, string>;
  userLocation?: [number, number] | null;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markers = useRef<L.Marker[]>([]);
  const userMarker = useRef<L.CircleMarker | null>(null);
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);
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
    if (!mapRef.current || mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: HO_CHI_MINH_BOUNDS,
      maxBoundsViscosity: 0.9,
    }).setView(HO_CHI_MINH_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance.current);
    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
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
      marker.bindPopup(
        `<strong>${escapeHtml(item.name)}</strong><br/><span>${escapeHtml(item.area || 'Địa điểm chưa cập nhật')}</span>`,
      );
      marker.on('mouseover', () => {
        onHoverRef.current(item.id);
        marker.openPopup();
      });
      marker.on('click', () => {
        onHoverRef.current(item.id);
        marker.openPopup();
      });
      markers.current.push(marker);
    });
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
    if (locatedItems.length === 1)
      map.setView([locatedItems[0].latitude!, locatedItems[0].longitude!], 16);
    else if (locatedItems.length > 1) {
      const bounds = L.latLngBounds(
        locatedItems.map((item) => [item.latitude!, item.longitude!] as L.LatLngTuple),
      );
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    } else {
      map.setView(HO_CHI_MINH_CENTER, 12);
    }
  }, [locatedItems, userLocation]);
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !activeId) return;
    const marker = markers.current.find(
      (candidate) =>
        (candidate.options as L.MarkerOptions & { restaurantId?: string }).restaurantId ===
        activeId,
    );
    const item = locatedItems.find((candidate) => candidate.id === activeId);
    if (!marker || !item) return;
    marker.setZIndexOffset(1000);
    map.flyTo([item.latitude!, item.longitude!], Math.max(map.getZoom(), 16), { duration: 0.45 });
    marker.openPopup();
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
      <style>{`.bep-map-marker-shell{background:transparent!important;border:0!important}.bep-map-marker{display:grid;place-items:center;width:30px;height:30px;border-radius:999px 999px 999px 0;background:#f97316;border:3px solid #fff;box-shadow:0 3px 10px rgba(67,20,7,.5),0 0 0 2px rgba(255,255,255,.72);transform:rotate(-45deg);transition:transform .2s,box-shadow .2s,opacity .2s,filter .2s}.bep-map-marker-core{width:9px;height:9px;border-radius:999px;background:#fff;transform:rotate(45deg);box-shadow:0 0 0 1px rgba(124,45,18,.25)}.bep-map-marker-is-active .bep-map-marker{transform:rotate(-45deg) scale(1.42);box-shadow:0 0 0 8px rgba(249,115,22,.2),0 5px 16px rgba(124,45,18,.5);animation:bep-marker-pulse 1.5s ease-in-out infinite}.bep-map-marker-is-muted{opacity:.82;filter:saturate(.9)}@keyframes bep-marker-pulse{0%,100%{box-shadow:0 0 0 5px rgba(249,115,22,.18),0 5px 16px rgba(124,45,18,.45)}50%{box-shadow:0 0 0 11px rgba(249,115,22,.04),0 5px 20px rgba(124,115,18,.55)}}`}</style>
      <div ref={mapRef} className="h-full w-full" />
      {selected && (
        <div className="absolute right-4 top-4 z-[500] max-w-sm rounded-2xl border border-primary/30 bg-card/95 p-3 shadow-lift backdrop-blur-sm">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-primary">
            Đang hiển thị trên bản đồ
          </div>
          <div className="flex gap-3">
            {selected.image ? (
              <SmartImage
                src={selected.image}
                alt={selected.name}
                className="h-16 w-16 rounded-xl object-cover"
              />
            ) : (
              <img
                src="/no-photo.svg"
                alt="Chưa có ảnh"
                className="h-16 w-16 rounded-xl object-cover"
              />
            )}
            <div className="min-w-0">
              <div className="truncate font-display text-lg">{selected.name}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selected.rating != null && selected.rating > 0 && (
                  <span>
                    <Star className="mr-1 inline h-3 w-3 fill-primary text-primary" />
                    {selected.rating}
                  </span>
                )}
                {selected.area && (
                  <span>
                    <MapPin className="mr-1 inline h-3 w-3" />
                    {selected.area}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <a
              href={selected.sourceUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`shrink-0 rounded-full border border-border px-3 py-1.5 text-xs ${selected.sourceUrl ? '' : 'pointer-events-none opacity-50'}`}
            >
              Mở trong Google Maps
            </a>
            <Link
              to={`/restaurants/${selected.id}`}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white"
            >
              Xem detail
            </Link>
          </div>
        </div>
      )}
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

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character,
  );
}

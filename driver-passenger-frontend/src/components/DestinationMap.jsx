"use client";

import { MapPin, Navigation } from "lucide-react";

// ---------------------------------------------------------------------------
// DestinationMap (Amir review A15; basemap unified in the Amir-test
// fix round, T-14) — a small, dependency-free destination preview +
// "Navigate" action for order/booking detail pages.
//
// Why not RideMap? RideMap is ride-coupled: it owns a MapLibre instance,
// route fetching, driver tracking and navigation framing. Detail pages
// here only need "where is it" + a hand-off to Google Maps for turn-by-
// turn navigation, so this renders a static tile preview (3×3 tiles at
// zoom 15 centred on the point, pure CSS pin overlay — no API key, no
// JS map library) and a big Navigate button that deep-links to Google
// Maps directions.
//
// T-14: the tiles are the app's OWN basemap — the same CARTO basemap
// family RideMap uses (dark-matter in dark mode, its light counterpart
// in light mode) — never the foreign default OSM look.
//
// Points arrive in two shapes across the app and both are accepted:
//   GeoJSON  { coordinates: [lng, lat], address }
//   plain    { latitude, longitude, address }
// ---------------------------------------------------------------------------

import { useTheme } from "@/components/theme/ThemeProvider";

const ZOOM = 15;
const TILE = 256;

export function pointCoords(point) {
    if (!point) return null;
    const longitude = Array.isArray(point.coordinates)
        ? Number(point.coordinates[0])
        : Number(point.longitude ?? point.lng);
    const latitude = Array.isArray(point.coordinates)
        ? Number(point.coordinates[1])
        : Number(point.latitude ?? point.lat);
    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
    ) {
        return null;
    }
    return { latitude, longitude };
}

export function navigateHref(latitude, longitude) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export function NavigateButton({ latitude, longitude, label = "Navigate" }) {
    const coords = pointCoords({ latitude, longitude });
    if (!coords) return null;
    return (
        <a
            href={navigateHref(coords.latitude, coords.longitude)}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99]"
        >
            <Navigation size={18} aria-hidden="true" />
            {label}
        </a>
    );
}

function tileUrl(theme, x, y) {
    const style = theme === "dark" ? "dark_all" : "light_all";
    return `https://basemaps.cartocdn.com/${style}/${ZOOM}/${x}/${y}.png`;
}

function tileGrid(latitude, longitude, theme) {
    const n = 2 ** ZOOM;
    const xFloat = ((longitude + 180) / 360) * n;
    const latRad = (latitude * Math.PI) / 180;
    const yFloat =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const centerX = Math.floor(xFloat);
    const centerY = Math.floor(yFloat);
    // Pixel offset of the exact point inside its centre tile.
    const fracX = xFloat - centerX;
    const fracY = yFloat - centerY;
    const tiles = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const x = centerX + dx;
            const y = centerY + dy;
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            tiles.push({
                key: `${x}-${y}`,
                src: tileUrl(theme, x, y),
                // Position relative to the container centre: the centre
                // tile's top-left sits at 50%/50% minus the fractional
                // offset of the point inside that tile.
                left: `calc(50% + ${(dx - fracX) * TILE}px)`,
                top: `calc(50% + ${(dy - fracY) * TILE}px)`,
            });
        }
    }
    return tiles;
}

export default function DestinationMap({
    point,
    latitude,
    longitude,
    label,
    navigateLabel = "Navigate",
    showNavigate = true,
}) {
    const { resolvedTheme } = useTheme();
    const coords =
        pointCoords(point) || pointCoords({ latitude, longitude });
    if (!coords) return null;
    const tiles = tileGrid(coords.latitude, coords.longitude, resolvedTheme);
    return (
        <div className="space-y-2">
            <div
                className="relative h-44 w-full overflow-hidden rounded-2xl bg-pd-surface-3"
                role="img"
                aria-label={label ? `Map — ${label}` : "Destination map"}
            >
                {tiles.map((tile) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        key={tile.key}
                        src={tile.src}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="absolute h-[256px] w-[256px] max-w-none select-none"
                        style={{ left: tile.left, top: tile.top }}
                    />
                ))}
                <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-[#D92D20] drop-shadow">
                    <MapPin size={34} className="fill-white" aria-hidden="true" />
                </span>
                {label && (
                    <span className="absolute bottom-2 left-2 max-w-[85%] truncate rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white">
                        {label}
                    </span>
                )}
            </div>
            {showNavigate && (
                <NavigateButton
                    latitude={coords.latitude}
                    longitude={coords.longitude}
                    label={navigateLabel}
                />
            )}
        </div>
    );
}

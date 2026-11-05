import { useEffect, useMemo, useRef, useState } from "react";
import { mountMap, mapsSearchUrl } from "./map_helpers.mjs";
import { US_STATES } from "./us_states";
import hatchMapsText from "./assets/hatch-maps.js" with { type: "text" };
import type { Place } from "./wx";

interface HatchMapsGlobal {
  isMetaMapSupported: () => { supported: boolean; reason?: string };
}

function hatchMapsGlobal(): HatchMapsGlobal | undefined {
  return (globalThis as unknown as { HatchMaps?: HatchMapsGlobal }).HatchMaps;
}

let hatchMapsTried = false;
/**
 * Inject the HatchMaps runtime (inlined as text by the bundler) as a
 * classic inline script so it registers window.HatchMaps. Returns false
 * when injection fails — callers fall back to the no-map view.
 */
function loadHatchMaps(): boolean {
  if (hatchMapsGlobal()) return true;
  if (hatchMapsTried) return false;
  hatchMapsTried = true;
  try {
    const script = document.createElement("script");
    // With type:"text", Bun inlines the file contents as a string; TS
    // models the import as the JS module instead, hence the cast.
    script.textContent = hatchMapsText as unknown as string;
    document.head.appendChild(script);
    return Boolean(hatchMapsGlobal());
  } catch {
    return false;
  }
}

export interface RadarFrame {
  time: number;
  path: string;
}

const ZOOM = 6;

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/**
 * US state geography for the radar: RainViewer tiles are transparent
 * precipitation with no basemap at all, so on their own the radar was
 * coloured blobs on a dark void — no states, no reference. The state
 * boundaries in ./us_states (Meta's published US-state boundary
 * geometry, simplified and bundled at build time so they render with
 * no runtime fetch) are projected into the exact tile-grid pixel
 * space and drawn over the radar with outlines + postal-code labels.
 */
const WORLD_PX = 256 * 2 ** ZOOM;

function lonToPx(lon: number): number {
  return ((lon + 180) / 360) * WORLD_PX;
}
function latToPx(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD_PX;
}

interface StateGeom {
  code: string;
  name: string;
  /** Polygons in MultiPolygon form: [poly][ring][point][lon,lat]. */
  polys: [number, number][][][];
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

const STATES: StateGeom[] = US_STATES.map((s) => ({
  code: s.c,
  name: s.n,
  polys: s.p,
  bbox: s.b,
}));

export function RadarPanel({
  host,
  past,
  nowcast,
  place,
}: {
  host: string | null;
  past: RadarFrame[];
  nowcast: RadarFrame[];
  place: Place;
}) {
  const frames = useMemo(() => [...past, ...nowcast], [past, nowcast]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    setIdx(Math.max(0, past.length - 1));
  }, [past]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 750);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const frame = frames[idx];
  const isNowcast = frame != null && idx >= past.length;

  const tiles = useMemo(() => {
    if (!host || !frame) return [];
    const cx = lon2tile(place.lon, ZOOM);
    const cy = lat2tile(place.lat, ZOOM);
    const out: { x: number; y: number; url: string }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        out.push({ x, y, url: `${host}${frame.path}/256/${ZOOM}/${x}/${y}/2/1_1.png` });
      }
    }
    return out;
  }, [host, frame, place]);

  // State outlines + labels in the tile grid's own pixel space
  // (3×3 tiles of 256px at ZOOM), so they stay registered with the radar.
  const stateOverlay = useMemo(() => {
    const states = STATES;
    const originX = (lon2tile(place.lon, ZOOM) - 1) * 256;
    const originY = (lat2tile(place.lat, ZOOM) - 1) * 256;
    const paths: { code: string; d: string }[] = [];
    const labels: { code: string; x: number; y: number }[] = [];
    for (const st of states) {
      const [minLon, minLat, maxLon, maxLat] = st.bbox;
      const x0 = lonToPx(minLon) - originX;
      const x1 = lonToPx(maxLon) - originX;
      const y0 = latToPx(maxLat) - originY;
      const y1 = latToPx(minLat) - originY;
      if (x1 < -40 || x0 > 808 || y1 < -40 || y0 > 808) continue;
      let d = "";
      for (const poly of st.polys) {
        for (const ring of poly) {
          let started = false;
          let lx = 0;
          let ly = 0;
          for (const [lo, la] of ring) {
            const x = lonToPx(lo) - originX;
            const y = latToPx(la) - originY;
            if (!started) {
              d += `M${x.toFixed(1)},${y.toFixed(1)}`;
              started = true;
              lx = x;
              ly = y;
            } else if ((x - lx) * (x - lx) + (y - ly) * (y - ly) >= 2.2) {
              d += `L${x.toFixed(1)},${y.toFixed(1)}`;
              lx = x;
              ly = y;
            }
          }
          if (started) d += "Z";
        }
      }
      if (d) paths.push({ code: st.code || st.name, d });
      // Label at the centre of the state's largest single ring (so
      // two-part states like Michigan label a landmass, not the lake
      // between) — only when it lands on the visible grid. Districts
      // too small to hold a label at this zoom (DC is ~10px wide and
      // its label collided with Maryland's) keep their outline only.
      let best: { x: number; y: number; area: number; w: number } | null = null;
      for (const poly of st.polys) {
        for (const ring of poly) {
          let rMinX = Infinity;
          let rMaxX = -Infinity;
          let rMinY = Infinity;
          let rMaxY = -Infinity;
          for (const [lo, la] of ring) {
            const x = lonToPx(lo) - originX;
            const y = latToPx(la) - originY;
            if (x < rMinX) rMinX = x;
            if (x > rMaxX) rMaxX = x;
            if (y < rMinY) rMinY = y;
            if (y > rMaxY) rMaxY = y;
          }
          const area = (rMaxX - rMinX) * (rMaxY - rMinY);
          if (!best || area > best.area) best = { x: (rMinX + rMaxX) / 2, y: (rMinY + rMaxY) / 2, area, w: rMaxX - rMinX };
        }
      }
      if (st.code && best && best.w >= 22 && best.x > 24 && best.x < 744 && best.y > 16 && best.y < 752) {
        labels.push({ code: st.code, x: best.x, y: best.y });
      }
    }
    return { paths, labels };
  }, [place]);

  // Exact pixel position of the selected place inside the 768px tile
  // grid — the old crosshair sat at the grid centre, which is only the
  // middle tile's centre and could be a full tile away from the place.
  const placePx = useMemo(() => {
    const originX = (lon2tile(place.lon, ZOOM) - 1) * 256;
    const originY = (lat2tile(place.lat, ZOOM) - 1) * 256;
    return { x: lonToPx(place.lon) - originX, y: latToPx(place.lat) - originY };
  }, [place]);

  if (!host || frames.length === 0) {
    return (
      <div className="rounded-[var(--radius)] p-4" style={{ background: "var(--viewport)", color: "var(--viewport-text)" }}>
        <p className="text-sm font-semibold">Live radar</p>
        <p className="mt-1 text-sm" style={{ color: "var(--viewport-dim)" }}>
          Radar frames are unavailable right now. The forecast above is unaffected — try Refresh in a bit.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius)]" style={{ background: "var(--viewport)", color: "var(--viewport-text)" }}>
      <div className="relative">
        <div className="grid grid-cols-3" aria-label={`Radar tiles around ${place.name}`}>
          {tiles.map((t) => (
            <div key={`${t.x}-${t.y}`} className="relative aspect-square" style={{ background: "#0d1a2e" }}>
              <img
                src={t.url}
                alt=""
                className="absolute inset-0 h-full w-full"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
              />
            </div>
          ))}
        </div>
        {/* US state boundaries + labels, registered to the tile grid */}
        {stateOverlay.paths.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 768 768" aria-hidden="true">
            {stateOverlay.paths.map((p) => (
              <path key={p.code} d={p.d} fill="rgba(148,184,255,0.07)" fillRule="evenodd" stroke="rgba(205,228,255,0.7)" strokeWidth="1.3" strokeLinejoin="round" />
            ))}
            {stateOverlay.labels.map((l) => (
              <text
                key={l.code}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="15"
                fontWeight="700"
                letterSpacing="1.5"
                fill="#e8f1ff"
                style={{ paintOrder: "stroke", stroke: "rgba(4,10,20,0.9)", strokeWidth: 4 }}
              >
                {l.code}
              </text>
            ))}
          </svg>
        )}
        {/* crosshair at the selected place's exact position in the grid */}
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${(placePx.x / 768) * 100}%`, top: `${(placePx.y / 768) * 100}%` }}
          aria-hidden="true"
        >
          <div className="h-4 w-4 rounded-full border-2" style={{ borderColor: "#f5a623", boxShadow: "0 0 0 3px rgba(245,166,35,0.25)" }} />
        </div>
        <div
          className="pointer-events-none absolute rounded px-1.5 py-0.5 text-[11px] font-bold"
          style={{ left: `calc(${(placePx.x / 768) * 100}% + 12px)`, top: `calc(${(placePx.y / 768) * 100}% - 26px)`, background: "rgba(6,12,24,0.75)", color: "#ffd88a" }}
          aria-hidden="true"
        >
          {place.name}
        </div>
        <div className="absolute left-2 top-2 rounded px-2 py-1 text-[11px] font-semibold" style={{ background: "rgba(6,12,24,0.75)" }}>
          {isNowcast ? "RADAR · FORECAST" : "RADAR · LIVE"}
        </div>
        <div className="mono absolute bottom-2 right-2 rounded px-2 py-1 text-[11px]" style={{ background: "rgba(6,12,24,0.75)" }}>
          {frame ? new Date(frame.time * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-label={playing ? "Pause radar animation" : "Play radar animation"}
          onClick={() => setPlaying((p) => !p)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
          style={{ background: "#1b2c4a", color: "#e8eef7" }}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          aria-label="Radar frame time"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={idx}
          onChange={(e) => { setIdx(Number(e.target.value)); setPlaying(false); }}
          className="w-full accent-[#38bdf8]"
        />
        <span className="mono shrink-0 text-[11px]" style={{ color: "var(--viewport-dim)" }}>
          z{ZOOM} · RainViewer
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-2.5">
        <p className="text-[11px]" style={{ color: "var(--viewport-dim)" }}>
          US state lines & labels under the radar · Precipitation: RainViewer
        </p>
        <a
          href="https://www.facebook.com/maps/attribution_terms"
          target="_blank"
          rel="noopener"
          className="text-[11px] underline"
          style={{ color: "var(--viewport-dim)" }}
        >
          © OpenStreetMap contributors, Map Data Legal Notices
        </a>
      </div>
      {/* preload the other frames so animation is smooth */}
      <div className="hidden" aria-hidden="true">
        {frames.slice(0, 14).map((f) => (
          <img key={f.path} src={`${host}${f.path}/256/${ZOOM}/${lon2tile(place.lon, ZOOM)}/${lat2tile(place.lat, ZOOM)}/2/1_1.png`} alt="" />
        ))}
      </div>
    </div>
  );
}

export function LocationMap({ place }: { place: Place }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setUnavailable(false);
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    let cancelled = false;
    // The map is an enhancement: load its runtime lazily and never let a
    // missing/failed runtime throw into React — fall back to the place info.
    try {
      if (!loadHatchMaps() || !hatchMapsGlobal()) {
        setUnavailable(true);
        return;
      }
      const handle = mountMap(
        el,
        {
          places: [{ label: `${place.name}, ${place.region}`, lat: place.lat, lng: place.lon }],
          // Regional view, not street level: at the old single-place
          // default (zoom 14) the map showed a few streets and none of
          // the state lines, borders or town labels the user looks for.
          // Zoom 6 on the light style makes state boundaries and place
          // labels clearly readable, with the pin on the place.
          center: { lat: place.lat, lng: place.lon },
          zoom: 6,
          baseStyle: "light",
        },
        () => { if (!cancelled) setUnavailable(true); },
      );
      if (handle === null) setUnavailable(true);
    } catch {
      if (!cancelled) setUnavailable(true);
    }
    return () => { cancelled = true; };
  }, [place]);

  const searchUrl = mapsSearchUrl({ label: place.name, locality: place.region, country: place.country, lat: place.lat, lng: place.lon });

  if (unavailable) {
    return (
      <div className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <p className="text-sm font-semibold">Map unavailable on this device</p>
        <p className="mono mt-1 text-sm" style={{ color: "var(--dim)" }}>
          {place.name} · {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
        </p>
        {searchUrl && (
          <a href={searchUrl} target="_blank" rel="noopener" className="mt-2 inline-block text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Open in maps →
          </a>
        )}
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} className="w-full overflow-hidden rounded-[var(--radius)]" style={{ height: 300 }} role="img" aria-label={`Map of ${place.name}, ${place.region}`} />
      {searchUrl && (
        <a href={searchUrl} target="_blank" rel="noopener" className="mt-2 inline-block text-sm font-semibold" style={{ color: "var(--accent)" }}>
          Open {place.name} in maps →
        </a>
      )}
    </div>
  );
}

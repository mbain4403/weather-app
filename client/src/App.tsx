import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import {
Bar,
CartesianGrid,
ComposedChart,
Legend,
Line,
LineChart,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { api, type ApiResponse } from "./api";
import { Globe, layerMeta, type GlobeLayer, type GlobeStorm } from "./Globe";
import { LocationMap, RadarPanel } from "./MapPanel";
import {
HOME,
aqiCategory,
codeInfo,
compass,
formatAsOf,
formatLatLon,
hourLabel,
isFreezing,
isSnow,
isThunder,
pollenLevel,
precip,
shortDate,
snowAmt,
speed,
temp,
tempVal,
timeLabel,
tropicalColor,
uvCategory,
visib,
weekday,
type Place,
type Units,
} from "./wx";

type Weather = NonNullable<ApiResponse<typeof api, "getWeather">["weather"]>;
type SavedLoc = ApiResponse<typeof api, "listSaved">["locations"][number];

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourAxisLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  if (h === 0) {
    const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split("-").map(Number);
    return `${DAY_SHORT[new Date(y, m - 1, d).getDay()] ?? ""} 12a`;
  }
  return hourLabel(iso).replace(" ", "").toLowerCase();
}

function SectionTitle({ children, sub }: { children: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--text)" }}>{children}</h2>
      {sub && <p className="text-sm" style={{ color: "var(--dim)" }}>{sub}</p>}
    </div>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--viewport-dim)" }}>{label}</p>
      <p className="mono truncate text-[15px] font-semibold" style={{ color: "var(--viewport-text)" }}>{value}</p>
      {sub && <p className="truncate text-[11px]" style={{ color: "var(--viewport-dim)" }}>{sub}</p>}
    </div>
  );
}

type Level = "Quiet" | "Watch" | "Active";
function levelStyle(level: Level): { bg: string; fg: string } {
  if (level === "Active") return { bg: "rgba(244,83,106,0.16)", fg: "var(--severe)" };
  if (level === "Watch") return { bg: "rgba(245,166,35,0.16)", fg: "var(--warn)" };
  return { bg: "var(--accent-soft)", fg: "var(--accent)" };
}

function IncidenceTile({ title, value, detail, level }: { title: string; value: string; detail: string; level: Level }) {
  const s = levelStyle(level);
  return (
    <div className="rounded-[var(--radius)] border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>{title}</p>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{level}</span>
      </div>
      <p className="mono mt-1.5 text-xl font-semibold" style={{ color: "var(--text)" }}>{value}</p>
      <p className="mt-0.5 text-[13px] leading-snug" style={{ color: "var(--dim)" }}>{detail}</p>
    </div>
  );
}

type TropicalStormData = ApiResponse<typeof api, "getTropical">["storms"][number];

/** Forecast-track plot: NHC track points on a latitude/longitude grid.
 *  This is a data chart (degrees on both axes), not a geographic map. */
function TropicalTrackChart({ storm }: { storm: TropicalStormData }) {
  const pts = storm.track;
  if (pts.length < 2) return null;
  const lats = pts.map((t) => t.lat);
  const lons = pts.map((t) => t.lon);
  const pad = 2.5;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;
  const W = 340;
  const H = 210;
  const ML = 34;
  const MR = 10;
  const MT = 10;
  const MB = 24;
  const x = (lon: number) => ML + ((lon - minLon) / Math.max(1, maxLon - minLon)) * (W - ML - MR);
  const y = (lat: number) => MT + (1 - (lat - minLat) / Math.max(1, maxLat - minLat)) * (H - MT - MB);
  const gridLons: number[] = [];
  for (let g = Math.ceil(minLon / 5) * 5; g <= maxLon; g += 5) gridLons.push(g);
  const gridLats: number[] = [];
  for (let g = Math.ceil(minLat / 5) * 5; g <= maxLat; g += 5) gridLats.push(g);
  const path = pts.map((t, i) => `${i === 0 ? "M" : "L"}${x(t.lon).toFixed(1)},${y(t.lat).toFixed(1)}`).join(" ");
  const color = tropicalColor(storm.category, storm.classification);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Forecast track chart for ${storm.classificationLabel} ${storm.name}: ${pts.length} NHC forecast points from ${formatLatLon(pts[0]!.lat, pts[0]!.lon)}`}>
        {gridLons.map((g) => (
          <g key={`lo${g}`}>
            <line x1={x(g)} y1={MT} x2={x(g)} y2={H - MB} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={x(g)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--dim)">{Math.abs(g)}°{g >= 0 ? "E" : "W"}</text>
          </g>
        ))}
        {gridLats.map((g) => (
          <g key={`la${g}`}>
            <line x1={ML} y1={y(g)} x2={W - MR} y2={y(g)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={ML - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--dim)">{Math.abs(g)}°{g >= 0 ? "N" : "S"}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="6 3" />
        {pts.map((t, i) => (
          <g key={i}>
            <circle cx={x(t.lon)} cy={y(t.lat)} r={i === 0 ? 5 : 3.5} fill={i === 0 ? color : "var(--surface)"} stroke={color} strokeWidth="2" />
            {(i === 0 || i === pts.length - 1) && (
              <text x={x(t.lon) + 8} y={y(t.lat) - 6} fontSize="10" fontWeight="700" fill="var(--text)">
                {i === 0 ? `Now · ${t.maxWindMph ?? "—"} mph` : `+5d · ${t.maxWindMph ?? "—"} mph`}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 max-h-36 overflow-y-auto pr-1" aria-label={`Forecast points for ${storm.name}`}>
        {pts.map((t, i) => (
          <p key={i} className="mono flex justify-between gap-2 py-0.5 text-xs" style={{ color: "var(--dim)", borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
            <span>{t.validLabel}</span>
            <span>{formatLatLon(t.lat, t.lon)}</span>
            <span style={{ color: "var(--text)" }}>{t.maxWindMph != null ? `${t.maxWindMph} mph` : "—"}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

// Stream a position fix instead of a single getCurrentPosition call: a
// cold GPS fix routinely takes longer than a one-shot 10s timeout, which
// is what kept producing "location timed out" failures. watchPosition
// delivers a fast coarse network fix first and then refinements — accept
// the first usable fix, keep the best one seen, and only report a
// timeout once the deadline passes with no fix at all.
function requestPosition(deadlineMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const accOf = (pos: GeolocationPosition) =>
      typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : Number.POSITIVE_INFINITY;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* watch already gone */
        }
      }
    };
    const succeed = (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(pos);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Reject with the original value: callers read the numeric `code`
      // off GeolocationPositionError, which is not an Error everywhere.
      reject(err);
    };
    timer = setTimeout(() => {
      if (best) succeed(best);
      else {
        const e = new Error("Location timed out") as Error & { code?: number };
        e.code = 3; // GeolocationPositionError.TIMEOUT
        fail(e);
      }
    }, deadlineMs);
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!best || accOf(pos) < accOf(best)) best = pos;
          if (accOf(pos) <= 1000) succeed(pos);
        },
        (err) => {
          // Permission denied is final. POSITION_UNAVAILABLE / TIMEOUT
          // from the watch are transient — a fix often still arrives
          // before the deadline, so keep waiting.
          if (err.code === err.PERMISSION_DENIED) fail(err);
        },
        { enableHighAccuracy: true, maximumAge: 60 * 1000 },
      );
    } catch (e) {
      fail(e);
    }
  });
}

export function App() {
  const queryClient = useQueryClient();
  const [place, setPlace] = useState<Place>(HOME);
  const [units, setUnits] = useState<Units>("imperial");
  const [forceTick, setForceTick] = useState(0);
  const [globeLayer, setGlobeLayer] = useState<GlobeLayer>("temp");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "active" | "denied" | "timeout" | "unavailable">("idle");
  const [isDevicePlace, setIsDevicePlace] = useState(false);
  const userPicked = useRef(false);
  const startupResolved = useRef(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);
  const geoRequestStartedAt = useRef(0);
  const lastManualPickAt = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const weatherQ = useQuery({
    queryKey: ["weather", place.lat, place.lon, forceTick],
    queryFn: () => api.getWeather({ lat: place.lat, lon: place.lon, force: forceTick > 0 }),
    placeholderData: (prev) => prev,
  });
  const globeQ = useQuery({
    queryKey: ["globe", forceTick],
    queryFn: () => api.getGlobe({ force: forceTick > 0 }),
  });
  const radarQ = useQuery({
    queryKey: ["radar"],
    queryFn: () => api.getRadar({}),
    staleTime: 5 * 60 * 1000,
  });
  const tropicalQ = useQuery({
    queryKey: ["tropical", forceTick],
    queryFn: () => api.getTropical({ force: forceTick > 0 }),
    staleTime: 5 * 60 * 1000,
  });
  const savedQ = useQuery({
    queryKey: ["saved"],
    queryFn: () => api.listSaved({}),
  });
  const searchQ = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.searchLocations({ query: debounced }),
    enabled: searchOpen && debounced.length >= 2,
  });

  // Startup place resolution — runs once the saved-places query settles.
  //
  // A saved default (the ★ place) always wins on open: it is an explicit
  // "load this first" choice, so the automatic device-location attempt
  // must not override it or race ahead of it. The previous code fired the
  // auto device attempt 350 ms after mount while the saved list was still
  // loading; whenever a fix landed it marked the place as user-picked and
  // switched to device mode, so the saved default was never adopted and
  // the user's saved location "disappeared" on every refresh. With no
  // saved default, the automatic device-location attempt runs as before
  // and falls back to HOME if permission is denied, location is off, or
  // it times out. A manual "Use my location" tap always works.
  useEffect(() => {
    if (startupResolved.current) return;
    if (userPicked.current) {
      // The user (or a manual location tap) already chose a place before
      // the saved list settled — don't second-guess it.
      startupResolved.current = true;
      return;
    }
    if (!savedQ.isSuccess && !savedQ.isError) return; // saved list still loading — wait for it
    startupResolved.current = true;
    const def = savedQ.data?.locations.find((l) => l.isDefault);
    if (def) {
      userPicked.current = true;
      setPlace({ name: def.name, region: def.region, country: def.country, lat: def.lat, lon: def.lon, timezone: def.timezone });
      return;
    }
    setTimeout(() => requestDeviceLocation(true), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQ.isSuccess, savedQ.isError, savedQ.data]);

  const requestDeviceLocation = (auto: boolean) => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("locating");
    const startedAt = Date.now();
    geoRequestStartedAt.current = startedAt;
    // A manual tap gets a longer deadline than the on-open attempt: a
    // first GPS fix can take up to half a minute.
    requestPosition(auto ? 20000 : 30000)
      .then(async (pos) => {
        // If the user manually picked a place after this request started,
        // don't override their choice.
        if (lastManualPickAt.current > startedAt) {
          setGeoStatus("idle");
          return;
        }
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const geo = await api.reverseGeocode({ lat, lon });
          const devicePlace: Place = {
            name: geo.name || "Current location",
            region: geo.region || "",
            country: geo.country || "",
            lat,
            lon,
            timezone: geo.timezone || "auto",
          };
          userPicked.current = true;
          setIsDevicePlace(true);
          setSaveNote(null);
          setPlace(devicePlace);
          setGeoStatus("active");
        } catch {
          const devicePlace: Place = { name: "Current location", region: "", country: "", lat, lon, timezone: "auto" };
          userPicked.current = true;
          setIsDevicePlace(true);
          setSaveNote(null);
          setPlace(devicePlace);
          setGeoStatus("active");
        }
      })
      .catch((err: { code?: number }) => {
        if (lastManualPickAt.current > startedAt) {
          setGeoStatus("idle");
          return;
        }
        if (err?.code === 1) setGeoStatus("denied");
        else if (err?.code === 3) setGeoStatus("timeout");
        else setGeoStatus("unavailable");
      });
  };

  const saveMut = useMutation({
    mutationFn: (p: Place) => api.saveLocation({ name: p.name, region: p.region, country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone }),
    onMutate: () => setSaveNote(null),
    onSuccess: (_data, p) => {
      // Say so out loud: a silent save is indistinguishable from a lost
      // one, which is exactly what the user reported.
      setSaveNote({ ok: true, text: `✓ ${p.name} saved — it stays in your places after a refresh.` });
      queryClient.invalidateQueries({ queryKey: ["saved"] });
    },
    onError: (_err, p) => {
      setSaveNote({ ok: false, text: `⚠ Couldn't save ${p.name} — check your connection and tap “+ Save” again. Nothing was saved.` });
    },
  });
  const removeMut = useMutation({
    mutationFn: (id: number) => api.removeLocation({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved"] }),
  });
  const defaultMut = useMutation({
    mutationFn: (id: number) => api.setDefaultLocation({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved"] }),
  });

  const w: Weather | null | undefined = weatherQ.data?.weather;
  const savedList: SavedLoc[] = savedQ.data?.locations ?? [];
  const placeSaved = savedList.some((l) => Math.abs(l.lat - place.lat) < 0.01 && Math.abs(l.lon - place.lon) < 0.01);

  const derived = useMemo(() => {
    if (!w) return null;
    const curHour = w.current.time.slice(0, 13);
    let start = w.hourly.time.findIndex((t) => t.slice(0, 13) >= curHour);
    if (start < 0) start = 0;
    const idx: number[] = [];
    for (let i = start; i < Math.min(w.hourly.time.length, start + 48); i++) idx.push(i);
    const pick = (arr: (number | null)[], fallback: number | null = null): (number | null)[] =>
      idx.map((i) => arr[i] ?? fallback);
    const maxOf = (arr: (number | null)[]) => arr.reduce<number | null>((m, v) => (v != null && (m == null || v > m) ? v : m), null);
    const minOf = (arr: (number | null)[]) => arr.reduce<number | null>((m, v) => (v != null && (m == null || v < m) ? v : m), null);
    const sumOf = (arr: (number | null)[]) => arr.reduce<number>((s, v) => s + (v ?? 0), 0);
    const temps48 = pick(w.hourly.temperature);
    const codes48 = pick(w.hourly.weatherCode);
    const gusts48 = pick(w.hourly.windGusts);
    const precip48 = pick(w.hourly.precip);
    const visIdx = idx.slice(0, 24).map((i) => w.hourly.visibility[i] ?? null);
    return {
      start,
      currentHourIdx: start,
      hours48: idx.map((i) => w.hourly.time[i] ?? ""),
      temps48,
      feels48: pick(w.hourly.feelsLike),
      prob48: pick(w.hourly.precipProb),
      codes48,
      maxTemp48: maxOf(temps48),
      minTemp48: minOf(temps48),
      thunderHours: codes48.filter(isThunder).length,
      snowHours: codes48.filter(isSnow).length,
      freezingHours: codes48.filter(isFreezing).length,
      maxCape: maxOf(pick(w.hourly.cape)),
      maxGust48: maxOf(gusts48),
      maxPrecipHour: maxOf(precip48),
      totalPrecip48: sumOf(precip48),
      totalSnow48: sumOf(pick(w.hourly.snowfall)),
      hoursBelowFreezing: temps48.filter((t) => t != null && t <= 32).length,
      minVis24: minOf(visIdx),
      maxFeels48: maxOf(pick(w.hourly.feelsLike)),
      curVis: w.hourly.visibility[start] ?? null,
      curUv: w.hourly.uvIndex[start] ?? null,
    };
  }, [w]);

  const hourlyChart = useMemo(() => {
    if (!w || !derived) return [];
    return derived.hours48.map((t, k) => ({
      label: hourAxisLabel(t),
      temp: derived.temps48[k] != null ? Math.round(tempVal(derived.temps48[k]!, units)) : null,
      prob: derived.prob48[k],
    }));
  }, [w, derived, units]);

  const modelChart = useMemo(() => {
    if (!w?.models) return [];
    const m = w.models;
    const curHour = w.current.time.slice(0, 13);
    let start = m.time.findIndex((t) => t.slice(0, 13) >= curHour);
    if (start < 0) start = 0;
    const rows: { label: string; ECMWF: number | null; GFS: number | null; ICON: number | null }[] = [];
    for (let i = start; i < Math.min(m.time.length, start + 72); i++) {
      const t = m.time[i]!;
      rows.push({
        label: hourAxisLabel(t),
        ECMWF: m.ecmwfTemp[i] != null ? Math.round(tempVal(m.ecmwfTemp[i]!, units)) : null,
        GFS: m.gfsTemp[i] != null ? Math.round(tempVal(m.gfsTemp[i]!, units)) : null,
        ICON: m.iconTemp[i] != null ? Math.round(tempVal(m.iconTemp[i]!, units)) : null,
      });
    }
    return rows;
  }, [w, units]);

  const modelHighs = useMemo(() => {
    if (!w?.models) return null;
    const today = w.daily.date[0] ?? "";
    const high = (arr: (number | null)[]) =>
      w.models!.time.reduce<number | null>((mx, t, i) => {
        const v = arr[i];
        return t.startsWith(today) && v != null && (mx == null || v > mx) ? v : mx;
      }, null);
    const e = high(w.models.ecmwfTemp);
    const g = high(w.models.gfsTemp);
    const ic = high(w.models.iconTemp);
    const vals = [e, g, ic].filter((v): v is number => v != null);
    const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : null;
    return { e, g, ic, spread };
  }, [w]);

  const pickPlace = (p: Place) => {
    userPicked.current = true;
    lastManualPickAt.current = Date.now();
    setSaveNote(null);
    // Picking any chip / search result / saved place leaves device mode
    // unless the place is exactly the current device coordinates.
    if (!(isDevicePlace && Math.abs(p.lat - place.lat) < 0.0001 && Math.abs(p.lon - place.lon) < 0.0001)) {
      setIsDevicePlace(false);
      if (geoStatus === "active") setGeoStatus("idle");
    }
    setPlace(p);
    setSearchOpen(false);
    setSearchText("");
  };

  const refresh = () => {
    setForceTick((t) => t + 1);
    radarQ.refetch();
    tropicalQ.refetch();
  };

  const globeStorms: GlobeStorm[] = useMemo(
    () =>
      (tropicalQ.data?.storms ?? []).map((s) => ({
        name: s.name,
        category: s.category,
        classificationLabel: s.classificationLabel,
        lat: s.lat,
        lon: s.lon,
        track: s.track.map((t) => ({ lat: t.lat, lon: t.lon })),
      })),
    [tropicalQ.data],
  );

  const meta = layerMeta(globeLayer);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="mx-auto max-w-6xl px-4 pb-12">
        {/* ── Location bar ─────────────────────────────── */}
        <header className="pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-tight">
                {place.name}
                {place.region ? <span className="font-semibold" style={{ color: "var(--dim)" }}>, {place.region}</span> : null}
              </h1>
              <p className="mono text-xs" style={{ color: "var(--dim)" }}>
                {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
                {w ? ` · ${w.timezone.replace("_", " ")}` : ""}
                {w?.elevation != null ? ` · elev ${Math.round(w.elevation * 3.28084)} ft` : ""}
              </p>
              {isDevicePlace && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  📍 Current location · Device
                </p>
              )}
              {geoStatus === "locating" && !isDevicePlace && (
                <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>📍 Locating your device — a first fix can take up to half a minute…</p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="flex shrink-0 overflow-hidden rounded-full border" style={{ borderColor: "var(--border)" }} role="group" aria-label="Units">
                {(["imperial", "metric"] as Units[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-label={u === "imperial" ? "Fahrenheit units" : "Celsius units"}
                    aria-pressed={units === u}
                    onClick={() => setUnits(u)}
                    className="px-3 py-1.5 text-sm font-bold"
                    style={units === u ? { background: "var(--accent)", color: "#fff" } : { background: "var(--surface)", color: "var(--dim)" }}
                  >
                    {u === "imperial" ? "°F" : "°C"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Use my location"
                aria-pressed={isDevicePlace}
                onClick={() => requestDeviceLocation(false)}
                disabled={geoStatus === "locating"}
                className="shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold"
                style={isDevicePlace
                  ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }
                  : { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
              >
                {geoStatus === "locating" ? "📍 Locating…" : "📍 Use my location"}
              </button>
              <button
                type="button"
                aria-label="Search locations"
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((o) => !o)}
                className="shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold"
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
              >
                ⌕ Search
              </button>
              <button
                type="button"
                aria-label="Refresh weather data"
                onClick={refresh}
                className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold text-white"
                style={{ background: "var(--accent)" }}
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="relative mt-3">
              <label htmlFor="loc-search" className="sr-only">Search for a city or town</label>
              <input
                id="loc-search"
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search any city or town — try “Denver” or “London”"
                className="w-full rounded-[var(--radius)] border px-3.5 py-2.5 text-base outline-none"
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
                autoFocus
              />
              {debounced.length >= 2 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-[var(--radius)] border shadow-xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  {searchQ.isPending && <p className="px-3.5 py-2.5 text-sm" style={{ color: "var(--dim)" }}>Searching…</p>}
                  {searchQ.data?.results.length === 0 && !searchQ.isPending && (
                    <p className="px-3.5 py-2.5 text-sm" style={{ color: "var(--dim)" }}>No places match that search.</p>
                  )}
                  {searchQ.data?.results.map((r, i) => (
                    <button
                      key={`${r.lat}-${r.lon}-${i}`}
                      type="button"
                      aria-label={`Show weather for ${r.name}, ${r.region}, ${r.country}`}
                      onClick={() => pickPlace(r)}
                      className="block w-full px-3.5 py-2.5 text-left"
                      style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
                    >
                      <span className="font-semibold">{r.name}</span>
                      <span style={{ color: "var(--dim)" }}> · {r.region}{r.country ? `, ${r.country}` : ""}</span>
                      <span className="mono block text-xs" style={{ color: "var(--dim)" }}>{r.lat.toFixed(3)}, {r.lon.toFixed(3)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* quick places */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {isDevicePlace && (
              <span
                className="rounded-full px-3 py-1 text-[13px] font-semibold text-white"
                style={{ background: "var(--accent)" }}
                aria-label="Current device location is active"
              >
                📍 {place.name} · Current location
              </span>
            )}
            <button
              type="button"
              aria-label="Show weather for New York City (default place)"
              onClick={() => pickPlace(HOME)}
              className="rounded-full px-3 py-1 text-[13px] font-semibold"
              style={!isDevicePlace && place.name === HOME.name && place.lat === HOME.lat
                ? { background: "var(--accent)", color: "#fff" }
                : { background: "var(--surface)", color: "var(--dim)", border: "1px solid var(--border)" }}
            >
              ⌂ New York City
            </button>
            {savedList.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-label={`Show weather for saved place ${l.name}`}
                onClick={() => pickPlace({ name: l.name, region: l.region, country: l.country, lat: l.lat, lon: l.lon, timezone: l.timezone })}
                className="rounded-full px-3 py-1 text-[13px] font-semibold"
                style={!isDevicePlace && Math.abs(l.lat - place.lat) < 0.01 && Math.abs(l.lon - place.lon) < 0.01
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "var(--surface)", color: "var(--dim)", border: "1px solid var(--border)" }}
              >
                {l.isDefault ? "★ " : ""}{l.name}
              </button>
            ))}
            {!placeSaved && (
              <button
                type="button"
                aria-label={`Save ${place.name} to my places`}
                onClick={() => saveMut.mutate(place)}
                disabled={saveMut.isPending}
                className="rounded-full px-3 py-1 text-[13px] font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                + Save {place.name}
              </button>
            )}
          </div>

          {saveNote && (
            <p
              className="mt-2 text-xs font-semibold"
              role={saveNote.ok ? "status" : "alert"}
              style={{ color: saveNote.ok ? "var(--accent)" : "var(--severe)" }}
            >
              {saveNote.text}
            </p>
          )}

          {(geoStatus === "denied" || geoStatus === "timeout" || geoStatus === "unavailable") && !isDevicePlace && (
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
              {geoStatus === "denied"
                ? <>📍 Device location was not allowed — showing {place.name} instead. Allow location in your browser or tap “Use my location” to try again, or use Search.</>
                : geoStatus === "timeout"
                  ? <>📍 Location timed out before your device could get a fix — showing {place.name} instead. Make sure location is switched on for your device, then tap “Use my location” to try again (a first fix can take up to half a minute), or use Search.</>
                  : <>📍 Device location is unavailable — showing {place.name} instead. Allow location in your browser or tap “Use my location” to try again, or use Search.</>}
            </p>
          )}
          {isDevicePlace && (
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
              📍 Showing weather for your device&apos;s current location. Your coordinates are only used to load this forecast and to look up the town name.
            </p>
          )}
          {w && (
            <p className="mono mt-2 text-xs" style={{ color: "var(--dim)" }}>
              {w.stale ? "⚠ Showing last good data · " : w.cached ? "Cached · " : "Live · "}
              updated {formatAsOf(w.asOf, w.timezone)} ({w.timezone.replace("_", " ")})
            </p>
          )}
        </header>

        {/* ── States ─────────────────────────────── */}
        {weatherQ.isPending && !w && (
          <div className="py-20 text-center">
            <p className="text-lg font-semibold">Pulling live data for {place.name}…</p>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Forecast models, air quality, alerts and the global grid.</p>
          </div>
        )}
        {weatherQ.data && !weatherQ.data.ok && (
          <div className="mt-6 rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--severe)", background: "var(--surface)" }}>
            <p className="font-bold" style={{ color: "var(--severe)" }}>The weather service is unreachable</p>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
              {weatherQ.data.error ?? "No data came back."} Nothing is shown rather than guessed — try again in a moment.
            </p>
            <button type="button" onClick={refresh} className="mt-3 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--accent)" }}>
              Try again
            </button>
          </div>
        )}

        {w && derived && (
          <main className="mt-5 space-y-10">
            {/* ── Alerts ─────────────────────────────── */}
            {w.alerts.length > 0 && (
              <section aria-label="Active weather alerts" className="space-y-2">
                {w.alerts.map((a, i) => (
                  <details key={i} className="rounded-[var(--radius)] border-2 p-4" style={{ borderColor: "var(--severe)", background: "var(--surface)" }} open={i === 0}>
                    <summary className="cursor-pointer font-bold" style={{ color: "var(--severe)" }}>
                      ⚠ {a.event} — {a.severity}
                      <span className="block text-sm font-semibold" style={{ color: "var(--text)" }}>{a.headline}</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{a.description}</p>
                    {a.instruction && <p className="mt-2 whitespace-pre-line text-sm font-semibold">{a.instruction}</p>}
                    <p className="mono mt-2 text-xs" style={{ color: "var(--dim)" }}>
                      {a.onset ? `From ${timeLabel(a.onset)}` : ""}{a.expires ? ` · until ${timeLabel(a.expires)}` : ""} · {a.sender}
                    </p>
                  </details>
                ))}
              </section>
            )}
            {w.alerts.length === 0 && (
              <p className="text-sm font-medium" style={{ color: "var(--dim)" }}>
                ✓ No active NWS watches or warnings for {place.name}.
                {w.alertsNote ? ` ${w.alertsNote}` : ""}
              </p>
            )}

            {/* ── Hero: current + globe ─────────────────────────────── */}
            <section aria-label="Current conditions and 3D globe" className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[var(--radius)] p-5" style={{ background: "var(--viewport)", color: "var(--viewport-text)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--viewport-dim)" }}>
                      {codeInfo(w.current.weatherCode).icon} {codeInfo(w.current.weatherCode).label}
                      {w.current.isDay === 0 ? " · Night" : ""}
                    </p>
                    <p className="mono mt-1 text-[76px] font-semibold leading-none tracking-tight">
                      {temp(w.current.temperature, units)}
                    </p>
                    <p className="mt-2 text-sm" style={{ color: "var(--viewport-dim)" }}>
                      Feels like <span className="mono font-semibold" style={{ color: "var(--viewport-text)" }}>{temp(w.current.feelsLike, units)}</span>
                      {"  ·  "}Today {temp(w.daily.tempMin[0], units)} – {temp(w.daily.tempMax[0], units)}
                    </p>
                  </div>
                  <p className="mono text-right text-xs leading-relaxed" style={{ color: "var(--viewport-dim)" }}>
                    {timeLabel(w.current.time)}
                    <br />local time
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
                  <Readout label="Wind" value={`${speed(w.current.windSpeed, units)}`} sub={`${compass(w.current.windDir)} · ${Math.round(w.current.windDir ?? 0)}°`} />
                  <Readout label="Gusts" value={speed(w.current.windGusts, units)} />
                  <Readout label="Humidity" value={w.current.humidity != null ? `${Math.round(w.current.humidity)}%` : "—"} />
                  <Readout label="Dew point" value={temp(w.current.dewPoint, units)} />
                  <Readout label="Pressure" value={w.current.pressure != null ? `${Math.round(w.current.pressure)} hPa` : "—"} sub={w.current.pressure != null ? `${(w.current.pressure * 0.02953).toFixed(2)} inHg` : undefined} />
                  <Readout label="Cloud cover" value={w.current.cloudCover != null ? `${Math.round(w.current.cloudCover)}%` : "—"} />
                  <Readout label="Precip now" value={precip(w.current.precipitation, units)} sub="last hour" />
                  <Readout label="Visibility" value={visib(derived.curVis, units)} />
                  <Readout label="UV index" value={derived.curUv != null ? `${derived.curUv.toFixed(0)} · ${uvCategory(derived.curUv)}` : "—"} />
                  <Readout label="Sunrise" value={timeLabel(w.daily.sunrise[0])} />
                  <Readout label="Sunset" value={timeLabel(w.daily.sunset[0])} />
                  <Readout label="Today's UV max" value={w.daily.uvMax[0] != null ? `${w.daily.uvMax[0]!.toFixed(0)} · ${uvCategory(w.daily.uvMax[0])}` : "—"} />
                </div>
              </div>

              <div className="rounded-[var(--radius)] p-4" style={{ background: "var(--viewport)", color: "var(--viewport-text)" }}>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Globe data layer">
                  {(Object.keys({ temp: 1, wind: 1, precip: 1, cloud: 1 }) as GlobeLayer[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-label={`Globe layer: ${layerMeta(l).label}`}
                      aria-pressed={globeLayer === l}
                      onClick={() => setGlobeLayer(l)}
                      className="rounded-full px-3 py-1 text-[13px] font-bold"
                      style={globeLayer === l ? { background: "#38bdf8", color: "#06121f" } : { background: "#1b2c4a", color: "#b9c9e2" }}
                    >
                      {layerMeta(l).label}
                    </button>
                  ))}
                </div>
                <div className="mx-auto mt-2 max-w-[430px]">
                  {globeQ.data && globeQ.data.points.length > 0 ? (
                    <Globe points={globeQ.data.points} layer={globeLayer} place={place} storms={globeStorms} />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-sm" style={{ color: "var(--viewport-dim)" }}>
                      {globeQ.isPending ? "Loading the global grid…" : "Global grid unavailable right now."}
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 px-1">
                  <span className="mono text-[11px]" style={{ color: "var(--viewport-dim)" }}>{meta.min}</span>
                  <div className="h-2 flex-1 rounded-full" style={{ background: meta.gradient }} aria-hidden="true" />
                  <span className="mono text-[11px]" style={{ color: "var(--viewport-dim)" }}>{meta.max}</span>
                </div>
                <p className="mt-2 px-1 text-xs" style={{ color: "var(--viewport-dim)" }}>
                  Drag to spin. The continents are real country-boundary landmasses; the coloured dots on them are 180 live grid samples from Open-Meteo. The amber ring is {place.name}, and the shaded side of the globe is in night right now.
                  {globeStorms.length > 0 ? ` Red rings with dashed tracks are live NHC tropical storms (${globeStorms.map((s) => s.name).join(", ")}) — full details in the Hurricane tracker below.` : ""}
                </p>
                <p className="px-1 pt-1 text-[11px]">
                  <a href="https://www.facebook.com/maps/attribution_terms" target="_blank" rel="noopener" className="underline" style={{ color: "var(--viewport-dim)" }}>
                    © OpenStreetMap contributors, Map Data Legal Notices
                  </a>
                </p>
              </div>
            </section>

            {/* ── Hourly ─────────────────────────────── */}
            <section aria-label="Hourly forecast">
              <SectionTitle sub="Next 48 hours · temperature and chance of precipitation">Hour by hour</SectionTitle>
              <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div style={{ height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={hourlyChart} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dim)" }} interval={5} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                      <YAxis yAxisId="t" tick={{ fontSize: 11, fill: "var(--dim)" }} tickLine={false} axisLine={false} domain={["dataMin - 4", "dataMax + 4"]} />
                      <YAxis yAxisId="p" orientation="right" hide domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: "#0b1220", border: "1px solid #22314f", borderRadius: 8, color: "#e8eef7", fontSize: 12 }}
                        formatter={(value, name) => [name === "Precip %" ? `${value ?? 0}%` : `${value}°`, name]}
                      />
                      <Bar yAxisId="p" dataKey="prob" name="Precip %" fill="#3b82f6" fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                      <Line yAxisId="t" type="monotone" dataKey="temp" name="Temp" stroke="#f5a623" strokeWidth={2.5} dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex gap-1 overflow-x-auto pb-1" aria-label="Next 24 hours at a glance">
                  {derived.hours48.slice(0, 24).map((t, k) => (
                    <div key={t} className="flex w-[52px] shrink-0 flex-col items-center rounded-lg px-1 py-2" style={{ background: "var(--surface2)" }}>
                      <span className="text-[11px] font-semibold" style={{ color: "var(--dim)" }}>{k === 0 ? "Now" : hourLabel(t)}</span>
                      <span className="my-1 text-lg" aria-hidden="true">{codeInfo(derived.codes48[k]).icon}</span>
                      <span className="mono text-sm font-bold">{temp(derived.temps48[k], units)}</span>
                      <span className="mono text-[11px]" style={{ color: derived.prob48[k] != null && derived.prob48[k]! >= 30 ? "var(--accent)" : "var(--dim)" }}>
                        {derived.prob48[k] != null ? `${Math.round(derived.prob48[k]!)}%` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Incidences ─────────────────────────────── */}
            <section aria-label="Weather incidences">
              <SectionTitle sub="Every hazard type, computed from the live forecast fields for the next 48 hours — not a generic summary">All weather incidences</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <IncidenceTile
                  title="⛈ Thunderstorms"
                  value={derived.thunderHours > 0 ? `${derived.thunderHours} storm hour${derived.thunderHours > 1 ? "s" : ""}` : "None forecast"}
                  detail={derived.maxCape != null
                    ? `Peak CAPE ${Math.round(derived.maxCape)} J/kg${derived.maxCape >= 1000 ? " — real storm fuel in the air" : derived.maxCape >= 400 ? " — some instability" : " — stable air"}.`
                    : "Instability data unavailable."}
                  level={derived.thunderHours > 0 ? "Active" : (derived.maxCape ?? 0) >= 1000 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="🌧 Heavy rain"
                  value={`${precip(derived.totalPrecip48, units)} / 48h`}
                  detail={`Wettest single hour ${precip(derived.maxPrecipHour, units)}.`}
                  level={derived.totalPrecip48 >= 1 ? "Active" : derived.totalPrecip48 >= 0.4 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="❄ Snow & ice"
                  value={derived.totalSnow48 > 0.2 ? snowAmt(derived.totalSnow48, units) : "No snow"}
                  detail={derived.freezingHours > 0
                    ? `${derived.freezingHours} hour(s) of freezing rain/drizzle in the window — ice risk.`
                    : derived.snowHours > 0 ? `${derived.snowHours} hour(s) with snow falling.` : "No frozen precipitation in the window."}
                  level={derived.freezingHours > 0 || derived.totalSnow48 >= 10 ? "Active" : derived.totalSnow48 > 0.2 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="🧊 Freeze"
                  value={derived.minTemp48 != null ? `Low ${temp(derived.minTemp48, units)}` : "—"}
                  detail={derived.hoursBelowFreezing > 0
                    ? `${derived.hoursBelowFreezing} hours at or below freezing in the next 48 — hoses, pipes and plants need cover.`
                    : "No below-freezing hours in the next 48."}
                  level={derived.minTemp48 != null && derived.minTemp48 <= 20 ? "Active" : derived.hoursBelowFreezing > 0 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="💨 Damaging wind"
                  value={derived.maxGust48 != null ? `Gusts ${speed(derived.maxGust48, units)}` : "—"}
                  detail={derived.maxGust48 != null && derived.maxGust48 >= 58
                    ? "Severe-threshold gusts — secure loose gear."
                    : derived.maxGust48 != null && derived.maxGust48 >= 40 ? "Strong gusts in the window." : "No damaging gusts in the window."}
                  level={derived.maxGust48 != null && derived.maxGust48 >= 58 ? "Active" : derived.maxGust48 != null && derived.maxGust48 >= 40 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="🌫 Fog"
                  value={derived.minVis24 != null ? `Worst ${visib(derived.minVis24, units)}` : "—"}
                  detail={derived.minVis24 != null && derived.minVis24 < 1000
                    ? "Dense-fog visibility expected in the next 24h — slow down on the road."
                    : derived.minVis24 != null && derived.minVis24 < 5000 ? "Patchy low visibility possible." : "Visibility stays good for 24h."}
                  level={derived.minVis24 != null && derived.minVis24 < 1000 ? "Active" : derived.minVis24 != null && derived.minVis24 < 5000 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="☀ Heat & UV"
                  value={derived.maxFeels48 != null ? `Feels ${temp(derived.maxFeels48, units)}` : "—"}
                  detail={`Peak UV today ${w.daily.uvMax[0] != null ? `${w.daily.uvMax[0]!.toFixed(0)} (${uvCategory(w.daily.uvMax[0])})` : "—"}.`}
                  level={(derived.maxFeels48 ?? 0) >= 100 ? "Active" : (derived.maxFeels48 ?? 0) >= 90 || (w.daily.uvMax[0] ?? 0) >= 8 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="🫁 Air quality"
                  value={w.airQuality?.aqi != null ? `AQI ${Math.round(w.airQuality.aqi)}` : "Unavailable"}
                  detail={w.airQuality
                    ? `${aqiCategory(w.airQuality.aqi).label}. PM2.5 ${w.airQuality.pm25 != null ? `${w.airQuality.pm25.toFixed(0)} µg/m³` : "—"} · Ozone ${w.airQuality.ozone != null ? `${w.airQuality.ozone.toFixed(0)} µg/m³` : "—"}.`
                    : "CAMS air-quality feed did not answer for this location."}
                  level={(w.airQuality?.aqi ?? 0) > 150 ? "Active" : (w.airQuality?.aqi ?? 0) > 100 ? "Watch" : "Quiet"}
                />
                <IncidenceTile
                  title="🤧 Pollen (CAMS)"
                  value={w.airQuality ? `Grass ${pollenLevel(w.airQuality.pollenGrass)}` : "Unavailable"}
                  detail={w.airQuality
                    ? `Birch ${pollenLevel(w.airQuality.pollenBirch)} · Alder ${pollenLevel(w.airQuality.pollenAlder)} · Ragweed ${pollenLevel(w.airQuality.pollenRagweed)}. Counts are grains/m³ from the European CAMS model.`
                    : "Pollen feed did not answer for this location."}
                  level={w.airQuality && [w.airQuality.pollenGrass, w.airQuality.pollenBirch, w.airQuality.pollenRagweed].some((v) => (v ?? 0) >= 50) ? "Watch" : "Quiet"}
                />
              </div>
            </section>

            {/* ── Hurricane / tropical tracker ─────────────────────────────── */}
            <section aria-label="Hurricane and tropical tracker">
              <SectionTitle sub="Live from the NOAA National Hurricane Center — every active tropical storm and hurricane in the Atlantic, East Pacific and Central Pacific, with the official NHC forecast track. Tracks are also plotted in red on the globe above.">
                🌀 Hurricane &amp; tropical tracker
              </SectionTitle>
              {tropicalQ.isPending && !tropicalQ.data && (
                <p className="text-sm" style={{ color: "var(--dim)" }}>Checking the National Hurricane Center for active storms…</p>
              )}
              {tropicalQ.data && !tropicalQ.data.ok && (
                <div className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--warn)", background: "var(--surface)" }}>
                  <p className="font-bold" style={{ color: "var(--warn)" }}>Hurricane feed unreachable</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
                    {tropicalQ.data.error ?? "The NHC feed did not answer."} No storm status is shown rather than guessed — tap Refresh to try again, or check nhc.noaa.gov directly.
                  </p>
                </div>
              )}
              {tropicalQ.data?.ok && tropicalQ.data.storms.length === 0 && (
                <div className="rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <p className="text-lg font-bold" style={{ color: "var(--accent)" }}>✓ All clear — no active tropical storms or hurricanes</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
                    The National Hurricane Center is not tracking any active storm in the Atlantic, East Pacific or Central Pacific right now.
                    {tropicalQ.data.asOf ? ` Checked ${formatAsOf(tropicalQ.data.asOf, w.timezone)}${tropicalQ.data.stale ? " (last good check — feed is having trouble)" : ""}.` : ""}
                  </p>
                </div>
              )}
              {tropicalQ.data?.ok && tropicalQ.data.storms.length > 0 && (
                <div className="space-y-4">
                  {tropicalQ.data.stale && (
                    <p className="text-sm font-medium" style={{ color: "var(--warn)" }}>⚠ NHC feed is having trouble — showing the last good storm data{tropicalQ.data.asOf ? ` from ${formatAsOf(tropicalQ.data.asOf, w.timezone)}` : ""}.</p>
                  )}
                  {tropicalQ.data.storms.map((s) => {
                    const color = tropicalColor(s.category, s.classification);
                    return (
                      <article key={s.id || s.name} className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }} aria-label={`${s.classificationLabel} ${s.name}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xl font-extrabold tracking-tight">
                              {s.name}
                              <span className="ml-2 align-middle text-sm font-bold" style={{ color: "var(--dim)" }}>{s.basin}</span>
                            </p>
                            <p className="mono text-xs" style={{ color: "var(--dim)" }}>
                              {formatLatLon(s.lat, s.lon)} · {s.lat.toFixed(2)}, {s.lon.toFixed(2)}
                              {s.lastUpdate ? ` · NHC update ${new Date(s.lastUpdate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}` : ""}
                            </p>
                          </div>
                          <span className="rounded-full px-3 py-1 text-sm font-extrabold" style={{ background: color, color: "#0b1220" }}>
                            {s.category ?? s.classificationLabel}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-4 lg:grid-cols-5">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:col-span-2">
                            <div><p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Max winds</p><p className="mono text-lg font-semibold">{units === "imperial" ? `${s.windMph ?? "—"} mph` : `${s.windMph != null ? Math.round(s.windMph * 1.60934) : "—"} km/h`}</p><p className="mono text-xs" style={{ color: "var(--dim)" }}>{s.intensityKt != null ? `${s.intensityKt} kt` : ""}{s.gustMph != null ? ` · gusts ${units === "imperial" ? `${s.gustMph} mph` : `${Math.round(s.gustMph * 1.60934)} km/h`}` : ""}</p></div>
                            <div><p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Pressure</p><p className="mono text-lg font-semibold">{s.pressureMb != null ? `${Math.round(s.pressureMb)} mb` : "—"}</p><p className="mono text-xs" style={{ color: "var(--dim)" }}>{s.pressureMb != null ? `${(s.pressureMb * 0.02953).toFixed(2)} inHg` : ""}</p></div>
                            <div><p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Movement</p><p className="mono text-lg font-semibold">{s.movementDirLabel}{s.movementDir != null ? ` ${Math.round(s.movementDir)}°` : ""}</p><p className="mono text-xs" style={{ color: "var(--dim)" }}>{s.movementSpeedMph != null ? `at ${units === "imperial" ? `${s.movementSpeedMph} mph` : `${Math.round(s.movementSpeedMph * 1.60934)} km/h`}` : ""}</p></div>
                            <div><p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>Classification</p><p className="text-lg font-semibold">{s.classificationLabel}</p><p className="mono text-xs" style={{ color: "var(--dim)" }}>{s.id.toUpperCase()}</p></div>
                            <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-3">
                              {s.advisoryUrl && <a href={s.advisoryUrl} target="_blank" rel="noopener" className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>NHC public advisory ↗</a>}
                              {s.graphicsUrl && <a href={s.graphicsUrl} target="_blank" rel="noopener" className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Track graphics ↗</a>}
                              {s.discussionUrl && <a href={s.discussionUrl} target="_blank" rel="noopener" className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Forecaster discussion ↗</a>}
                            </div>
                          </div>
                          <div className="lg:col-span-3">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--dim)" }}>NHC forecast track · latitude / longitude</p>
                            {s.track.length >= 2 ? <TropicalTrackChart storm={s} /> : <p className="text-sm" style={{ color: "var(--dim)" }}>Forecast track points were not in the latest advisory — current position is plotted on the globe above.</p>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  <p className="text-xs" style={{ color: "var(--dim)" }}>
                    Category is the Saffir–Simpson scale from NHC sustained winds. Even a storm far out in the Pacific matters here only if its remnants track northeast — watch the forecast points.
                    {tropicalQ.data.asOf ? ` Feed checked ${formatAsOf(tropicalQ.data.asOf, w.timezone)}.` : ""}
                  </p>
                </div>
              )}
            </section>

            {/* ── Radar & map ─────────────────────────────── */}
            <section aria-label="Radar and map">
              <SectionTitle sub="Animated precipitation radar over US state lines, centered on the selected place, plus the regional map view with state borders and town labels">Radar & map</SectionTitle>
              <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <RadarPanel host={radarQ.data?.host ?? null} past={radarQ.data?.frames ?? []} nowcast={radarQ.data?.nowcast ?? []} place={place} />
                </div>
                <div className="lg:col-span-2">
                  <LocationMap place={place} />
                </div>
              </div>
            </section>

            {/* ── Models ─────────────────────────────── */}
            <section aria-label="Forecast model comparison">
              <SectionTitle sub="The three big global models, run side by side on the same hours — where they agree, trust it; where they split, that's the uncertainty">Model face-off · ECMWF vs GFS vs ICON</SectionTitle>
              {w.models && modelChart.length > 0 ? (
                <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <div className="mb-2 flex flex-wrap gap-4 px-1 text-sm">
                    <span>ECMWF high today: <strong className="mono">{temp(modelHighs?.e, units)}</strong></span>
                    <span>GFS: <strong className="mono">{temp(modelHighs?.g, units)}</strong></span>
                    <span>ICON: <strong className="mono">{temp(modelHighs?.ic, units)}</strong></span>
                    {modelHighs?.spread != null && (
                      <span style={{ color: "var(--dim)" }}>
                        Spread <strong className="mono" style={{ color: "var(--text)" }}>{units === "imperial" ? `${modelHighs.spread.toFixed(0)}°F` : `${(modelHighs.spread * 5 / 9).toFixed(0)}°C`}</strong>
                        {modelHighs.spread <= 3 ? " — models agree, high confidence" : modelHighs.spread <= 7 ? " — some disagreement" : " — models split, low confidence"}
                      </span>
                    )}
                  </div>
                  <div style={{ height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={modelChart} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dim)" }} interval={11} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--dim)" }} tickLine={false} axisLine={false} domain={["dataMin - 4", "dataMax + 4"]} />
                        <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid #22314f", borderRadius: 8, color: "#e8eef7", fontSize: 12 }} formatter={(value, name) => [`${value}°`, name]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="ECMWF" stroke="#38bdf8" strokeWidth={2.5} dot={false} connectNulls />
                        <Line type="monotone" dataKey="GFS" stroke="#f5a623" strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="ICON" stroke="#4ade80" strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="px-1 pt-1 text-xs" style={{ color: "var(--dim)" }}>Next 72 hours of 2 m temperature per model, via Open-Meteo's model endpoints. ECMWF IFS is the European model — usually the one to beat.</p>
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--dim)" }}>The multi-model feed did not answer for this location. The main forecast above is Open-Meteo's best-match blend.</p>
              )}
            </section>

            {/* ── 10-day ─────────────────────────────── */}
            <section aria-label="Ten day forecast">
              <SectionTitle sub="Daily highs, lows, precipitation and wind">10-day outlook</SectionTitle>
              <div className="overflow-hidden rounded-[var(--radius)] border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                {w.daily.date.map((d, i) => {
                  const allMax = Math.max(...w.daily.tempMax.filter((v): v is number => v != null));
                  const allMin = Math.min(...w.daily.tempMin.filter((v): v is number => v != null));
                  const lo = w.daily.tempMin[i];
                  const hi = w.daily.tempMax[i];
                  const span = Math.max(1, allMax - allMin);
                  const left = lo != null ? ((lo - allMin) / span) * 100 : 0;
                  const width = lo != null && hi != null ? Math.max(4, ((hi - lo) / span) * 100) : 0;
                  return (
                    <div key={d} className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                      <div className="w-[86px] shrink-0">
                        <p className="text-sm font-bold leading-tight">{weekday(d, i)}</p>
                        <p className="mono text-xs" style={{ color: "var(--dim)" }}>{shortDate(d)}</p>
                      </div>
                      <span className="text-xl" role="img" aria-label={codeInfo(w.daily.weatherCode[i]).label}>{codeInfo(w.daily.weatherCode[i]).icon}</span>
                      <div className="hidden w-[110px] shrink-0 text-xs sm:block" style={{ color: "var(--dim)" }}>
                        {codeInfo(w.daily.weatherCode[i]).label}
                        {(w.daily.snowfallSum[i] ?? 0) > 0.2 ? <span className="block">Snow {snowAmt(w.daily.snowfallSum[i], units)}</span> : null}
                      </div>
                      <span className="mono w-[52px] shrink-0 text-right text-xs font-semibold" style={{ color: (w.daily.precipProbMax[i] ?? 0) >= 30 ? "var(--accent)" : "var(--dim)" }}>
                        {(w.daily.precipProbMax[i] ?? 0) > 0 ? `💧${Math.round(w.daily.precipProbMax[i]!)}%` : ""}
                      </span>
                      <span className="mono text-sm" style={{ color: "var(--dim)" }}>{temp(lo, units)}</span>
                      <div className="relative h-1.5 flex-1 rounded-full" style={{ background: "var(--surface2)" }} aria-hidden="true">
                        <div className="absolute top-0 h-1.5 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: "linear-gradient(90deg,#38bdf8,#f5a623)" }} />
                      </div>
                      <span className="mono text-sm font-bold">{temp(hi, units)}</span>
                      <span className="mono hidden w-[86px] shrink-0 text-right text-xs md:block" style={{ color: "var(--dim)" }}>
                        💨 {speed(w.daily.gustMax[i], units).replace(" mph", "")} mph
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Saved places manager ─────────────────────────────── */}
            <section aria-label="My saved places">
              <SectionTitle sub="Places you bookmark stay here; the ★ one loads first next time">My places</SectionTitle>
              {savedList.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--dim)" }}>
                  Nothing saved yet. Search for a town, open its weather, and tap “+ Save” — New York City is always one tap away in the chips above.
                </p>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius)] border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  {savedList.map((l, i) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5" style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                      <button
                        type="button"
                        aria-label={`Show weather for ${l.name}`}
                        onClick={() => pickPlace({ name: l.name, region: l.region, country: l.country, lat: l.lat, lon: l.lon, timezone: l.timezone })}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="font-semibold">{l.name}</span>
                        <span style={{ color: "var(--dim)" }}> · {l.region}{l.country ? `, ${l.country}` : ""}</span>
                        <span className="mono block text-xs" style={{ color: "var(--dim)" }}>{l.lat.toFixed(3)}, {l.lon.toFixed(3)}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={l.isDefault ? `${l.name} is the default place` : `Make ${l.name} the default place`}
                        onClick={() => defaultMut.mutate(l.id)}
                        className="rounded-full px-3 py-1 text-[13px] font-bold"
                        style={l.isDefault ? { background: "var(--accent-soft)", color: "var(--accent)" } : { background: "var(--surface2)", color: "var(--dim)" }}
                      >
                        {l.isDefault ? "★ Default" : "☆ Set default"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${l.name} from saved places`}
                        onClick={() => removeMut.mutate(l.id)}
                        className="rounded-full px-3 py-1 text-[13px] font-bold"
                        style={{ background: "var(--surface2)", color: "var(--severe)" }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <footer className="border-t pt-4 text-xs leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--dim)" }}>
              Data: Open-Meteo (forecast blend, ECMWF IFS / NOAA GFS / DWD ICON model runs, CAMS air quality & pollen) · US National Weather Service alerts ·
              NOAA National Hurricane Center (active storms & forecast tracks) · RainViewer radar · Globe continents and radar state lines from Meta's published country & US-state boundary geometry · Geocoding by Open-Meteo · Device location reverse-geocoding by OpenStreetMap Nominatim.
              Forecasts are model output, not a guarantee — for life-safety decisions follow NWS and local officials.
              {globeQ.data?.asOf ? ` Globe grid as of ${formatAsOf(globeQ.data.asOf, w.timezone)}.` : ""}
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}

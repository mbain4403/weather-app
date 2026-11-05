// Actions for the Custom Weather App.
//
// All weather data is fetched live on the server from keyless public APIs
// (proven in DATA-PLAN.md):
//   - Open-Meteo forecast (best-match blend + ECMWF/GFS/ICON model series)
//   - Open-Meteo air quality (CAMS: US AQI, PM, ozone, pollen)
//   - NWS api.weather.gov active alerts (US points)
//   - RainViewer radar frame index (client builds tile URLs from it)
//   - Open-Meteo geocoding for location search
//
// Payloads are cached in weather_cache for 15 minutes; on an upstream
// failure the stale cache is served with stale=true rather than invented
// data, and with no cache the action returns ok=false so the UI can show
// an honest error state.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const numArr = z.array(z.number().nullable());
const strArr = z.array(z.string());

const alertSchema = z.object({
  event: z.string(),
  severity: z.string(),
  urgency: z.string(),
  headline: z.string(),
  description: z.string(),
  instruction: z.string().nullable(),
  onset: z.string().nullable(),
  expires: z.string().nullable(),
  sender: z.string(),
});

const weatherPayload = z.object({
  timezone: z.string(),
  utcOffsetSeconds: z.number(),
  elevation: z.number().nullable(),
  asOf: z.string(),
  cached: z.boolean(),
  stale: z.boolean(),
  current: z.object({
    time: z.string(),
    temperature: z.number().nullable(),
    feelsLike: z.number().nullable(),
    humidity: z.number().nullable(),
    dewPoint: z.number().nullable(),
    weatherCode: z.number().nullable(),
    pressure: z.number().nullable(),
    windSpeed: z.number().nullable(),
    windDir: z.number().nullable(),
    windGusts: z.number().nullable(),
    precipitation: z.number().nullable(),
    cloudCover: z.number().nullable(),
    isDay: z.number().nullable(),
  }),
  hourly: z.object({
    time: strArr,
    temperature: numArr,
    feelsLike: numArr,
    precipProb: numArr,
    precip: numArr,
    weatherCode: numArr,
    windSpeed: numArr,
    windGusts: numArr,
    windDir: numArr,
    visibility: numArr,
    cape: numArr,
    snowfall: numArr,
    uvIndex: numArr,
    isDay: numArr,
  }),
  daily: z.object({
    date: strArr,
    weatherCode: numArr,
    tempMax: numArr,
    tempMin: numArr,
    feelsMax: numArr,
    feelsMin: numArr,
    sunrise: strArr,
    sunset: strArr,
    uvMax: numArr,
    precipSum: numArr,
    precipProbMax: numArr,
    windMax: numArr,
    gustMax: numArr,
    snowfallSum: numArr,
  }),
  airQuality: z
    .object({
      aqi: z.number().nullable(),
      pm25: z.number().nullable(),
      pm10: z.number().nullable(),
      ozone: z.number().nullable(),
      pollenGrass: z.number().nullable(),
      pollenBirch: z.number().nullable(),
      pollenAlder: z.number().nullable(),
      pollenRagweed: z.number().nullable(),
    })
    .nullable(),
  alerts: z.array(alertSchema),
  alertsNote: z.string().nullable(),
  models: z
    .object({
      time: strArr,
      ecmwfTemp: numArr,
      gfsTemp: numArr,
      iconTemp: numArr,
      ecmwfPrecipProb: numArr,
      gfsPrecipProb: numArr,
      iconPrecipProb: numArr,
    })
    .nullable(),
});

type WeatherPayload = z.infer<typeof weatherPayload>;
type Alert = z.infer<typeof alertSchema>;

const getWeatherResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  weather: weatherPayload.nullable(),
});

const CACHE_MS = 15 * 60 * 1000;
const UA = { "User-Agent": "CustomWeatherApp/1.0 (personal weather dashboard)" };

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { ...UA, ...(headers ?? {}) } });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${new URL(url).host}`);
  return (await res.json()) as unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function numSeries(v: unknown): (number | null)[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
}

function strSeries(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : ""));
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Index of the hourly entry closest to (not after) the current time string. */
function currentHourIndex(times: string[], currentTime: string): number {
  let idx = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t && t <= currentTime) idx = i;
    else break;
  }
  return idx;
}

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

async function fetchAlerts(lat: number, lon: number): Promise<{ alerts: Alert[]; note: string | null }> {
  try {
    const raw = await fetchJson(
      `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
      { Accept: "application/geo+json" },
    );
    const root = asRecord(raw);
    const features = Array.isArray(root.features) ? root.features : [];
    const alerts: Alert[] = features.map((f) => {
      const props = asRecord(asRecord(f).properties);
      const s = (k: string): string => (typeof props[k] === "string" ? (props[k] as string) : "");
      const sn = (k: string): string | null => (typeof props[k] === "string" ? (props[k] as string) : null);
      return {
        event: s("event") || "Weather alert",
        severity: s("severity") || "Unknown",
        urgency: s("urgency") || "",
        headline: s("headline") || s("event") || "Weather alert",
        description: s("description"),
        instruction: sn("instruction"),
        onset: sn("onset"),
        expires: sn("ends") ?? sn("expires"),
        sender: s("senderName"),
      };
    });
    alerts.sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5) ||
        (a.onset ?? "").localeCompare(b.onset ?? ""),
    );
    return { alerts, note: null };
  } catch {
    // api.weather.gov only covers US points; a failure here most likely
    // means the location is outside NWS coverage. Say so instead of
    // implying an all-clear.
    return { alerts: [], note: "Official alerts are wired through the US National Weather Service; this location is outside its coverage, so check local providers for warnings." };
  }
}

async function fetchAirQuality(lat: number, lon: number, currentTime: string, timezone: string) {
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=us_aqi,pm2_5,pm10,ozone,alder_pollen,birch_pollen,grass_pollen,ragweed_pollen` +
      `&forecast_days=3&timezone=${encodeURIComponent(timezone)}`;
    const root = asRecord(await fetchJson(url));
    const hourly = asRecord(root.hourly);
    const times = strSeries(hourly.time);
    const idx = currentHourIndex(times, currentTime);
    const pick = (k: string): number | null => {
      const series = numSeries(hourly[k]);
      return series[idx] ?? null;
    };
    return {
      aqi: pick("us_aqi"),
      pm25: pick("pm2_5"),
      pm10: pick("pm10"),
      ozone: pick("ozone"),
      pollenGrass: pick("grass_pollen"),
      pollenBirch: pick("birch_pollen"),
      pollenAlder: pick("alder_pollen"),
      pollenRagweed: pick("ragweed_pollen"),
    };
  } catch {
    return null;
  }
}

async function fetchModels(lat: number, lon: number, timezone: string) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation_probability` +
      `&models=ecmwf_ifs025,gfs_seamless,icon_seamless` +
      `&temperature_unit=fahrenheit&forecast_days=4&timezone=${encodeURIComponent(timezone)}`;
    const root = asRecord(await fetchJson(url));
    const hourly = asRecord(root.hourly);
    return {
      time: strSeries(hourly.time),
      ecmwfTemp: numSeries(hourly["temperature_2m_ecmwf_ifs025"]),
      gfsTemp: numSeries(hourly["temperature_2m_gfs_seamless"]),
      iconTemp: numSeries(hourly["temperature_2m_icon_seamless"]),
      ecmwfPrecipProb: numSeries(hourly["precipitation_probability_ecmwf_ifs025"]),
      gfsPrecipProb: numSeries(hourly["precipitation_probability_gfs_seamless"]),
      iconPrecipProb: numSeries(hourly["precipitation_probability_icon_seamless"]),
    };
  } catch {
    return null;
  }
}

async function fetchWeatherFresh(lat: number, lon: number): Promise<WeatherPayload> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover,is_day` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,cape,snowfall,uv_index,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,snowfall_sum` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=10`;
  const root = asRecord(await fetchJson(url));
  const timezone = typeof root.timezone === "string" ? root.timezone : "UTC";
  const current = asRecord(root.current);
  const hourly = asRecord(root.hourly);
  const daily = asRecord(root.daily);
  const currentTime = typeof current.time === "string" ? current.time : new Date().toISOString();

  const [airQuality, alertsResult, models] = await Promise.all([
    fetchAirQuality(lat, lon, currentTime, timezone),
    fetchAlerts(lat, lon),
    fetchModels(lat, lon, timezone),
  ]);

  return {
    timezone,
    utcOffsetSeconds: typeof root.utc_offset_seconds === "number" ? root.utc_offset_seconds : 0,
    elevation: numOrNull(root.elevation),
    asOf: new Date().toISOString(),
    cached: false,
    stale: false,
    current: {
      time: currentTime,
      temperature: numOrNull(current.temperature_2m),
      feelsLike: numOrNull(current.apparent_temperature),
      humidity: numOrNull(current.relative_humidity_2m),
      dewPoint: numOrNull(current.dew_point_2m),
      weatherCode: numOrNull(current.weather_code),
      pressure: numOrNull(current.pressure_msl),
      windSpeed: numOrNull(current.wind_speed_10m),
      windDir: numOrNull(current.wind_direction_10m),
      windGusts: numOrNull(current.wind_gusts_10m),
      precipitation: numOrNull(current.precipitation),
      cloudCover: numOrNull(current.cloud_cover),
      isDay: numOrNull(current.is_day),
    },
    hourly: {
      time: strSeries(hourly.time),
      temperature: numSeries(hourly.temperature_2m),
      feelsLike: numSeries(hourly.apparent_temperature),
      precipProb: numSeries(hourly.precipitation_probability),
      precip: numSeries(hourly.precipitation),
      weatherCode: numSeries(hourly.weather_code),
      windSpeed: numSeries(hourly.wind_speed_10m),
      windGusts: numSeries(hourly.wind_gusts_10m),
      windDir: numSeries(hourly.wind_direction_10m),
      visibility: numSeries(hourly.visibility),
      cape: numSeries(hourly.cape),
      snowfall: numSeries(hourly.snowfall),
      uvIndex: numSeries(hourly.uv_index),
      isDay: numSeries(hourly.is_day),
    },
    daily: {
      date: strSeries(daily.time),
      weatherCode: numSeries(daily.weather_code),
      tempMax: numSeries(daily.temperature_2m_max),
      tempMin: numSeries(daily.temperature_2m_min),
      feelsMax: numSeries(daily.apparent_temperature_max),
      feelsMin: numSeries(daily.apparent_temperature_min),
      sunrise: strSeries(daily.sunrise),
      sunset: strSeries(daily.sunset),
      uvMax: numSeries(daily.uv_index_max),
      precipSum: numSeries(daily.precipitation_sum),
      precipProbMax: numSeries(daily.precipitation_probability_max),
      windMax: numSeries(daily.wind_speed_10m_max),
      gustMax: numSeries(daily.wind_gusts_10m_max),
      snowfallSum: numSeries(daily.snowfall_sum),
    },
    airQuality,
    alerts: alertsResult.alerts,
    alertsNote: alertsResult.note,
    models,
  };
}

// Globe grid: one multi-location Open-Meteo call. Lats every 15° from
// -60..75, lons every 20° → 180 current-condition samples that the client
// projects onto the canvas globe for the selected layer.
const GLOBE_LATS = [-60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
const GLOBE_LONS: number[] = [];
for (let lon = -180; lon < 180; lon += 20) GLOBE_LONS.push(lon);

const globePoint = z.object({
  lat: z.number(),
  lon: z.number(),
  temp: z.number().nullable(),
  windSpeed: z.number().nullable(),
  windDir: z.number().nullable(),
  precip: z.number().nullable(),
  cloud: z.number().nullable(),
  code: z.number().nullable(),
});

const globeResponse = z.object({
  ok: z.boolean(),
  asOf: z.string().nullable(),
  points: z.array(globePoint),
});

async function fetchGlobeFresh(): Promise<z.infer<typeof globeResponse>> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const la of GLOBE_LATS) for (const lo of GLOBE_LONS) { lats.push(la); lons.push(lo); }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=1`;
  const raw = await fetchJson(url);
  const list = Array.isArray(raw) ? raw : [raw];
  const points = list.map((item, i) => {
    const rec = asRecord(item);
    const cur = asRecord(rec.current);
    return {
      lat: typeof rec.latitude === "number" ? rec.latitude : (GLOBE_LATS[Math.floor(i / GLOBE_LONS.length)] ?? 0),
      lon: typeof rec.longitude === "number" ? rec.longitude : (GLOBE_LONS[i % GLOBE_LONS.length] ?? 0),
      temp: numOrNull(cur.temperature_2m),
      windSpeed: numOrNull(cur.wind_speed_10m),
      windDir: numOrNull(cur.wind_direction_10m),
      precip: numOrNull(cur.precipitation),
      cloud: numOrNull(cur.cloud_cover),
      code: numOrNull(cur.weather_code),
    };
  });
  return { ok: true, asOf: new Date().toISOString(), points };
}

// ── Tropical / hurricane tracker (NOAA NHC) ─────────────────────────
// Source: https://www.nhc.noaa.gov/CurrentStorms.json (official NHC
// active-storms feed, verified live: Hurricane Vance EP222026). Forecast
// track points are parsed from each storm's official NHC forecast
// advisory text (the TCM product linked from the feed), whose lines read
// "FORECAST VALID 24/1800Z 13.1N 103.1W / MAX WIND 95 KT" / "OUTLOOK
// VALID …" — parser verified against the live Vance advisory.

const tropicalTrackPoint = z.object({
  validLabel: z.string(),
  lat: z.number(),
  lon: z.number(),
  maxWindKt: z.number().nullable(),
  maxWindMph: z.number().nullable(),
  outlook: z.boolean(),
});

const tropicalStorm = z.object({
  id: z.string(),
  name: z.string(),
  basin: z.string(),
  classification: z.string(),
  classificationLabel: z.string(),
  category: z.string().nullable(),
  intensityKt: z.number().nullable(),
  windMph: z.number().nullable(),
  gustKt: z.number().nullable(),
  gustMph: z.number().nullable(),
  pressureMb: z.number().nullable(),
  lat: z.number(),
  lon: z.number(),
  movementDir: z.number().nullable(),
  movementDirLabel: z.string(),
  movementSpeedKt: z.number().nullable(),
  movementSpeedMph: z.number().nullable(),
  lastUpdate: z.string().nullable(),
  track: z.array(tropicalTrackPoint),
  advisoryUrl: z.string().nullable(),
  graphicsUrl: z.string().nullable(),
  discussionUrl: z.string().nullable(),
});

const tropicalResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  asOf: z.string().nullable(),
  cached: z.boolean(),
  stale: z.boolean(),
  storms: z.array(tropicalStorm),
});

type TropicalStorm = z.infer<typeof tropicalStorm>;

const CLASS_LABELS: Record<string, string> = {
  HU: "Hurricane",
  TS: "Tropical Storm",
  TD: "Tropical Depression",
  STS: "Subtropical Storm",
  STD: "Subtropical Depression",
  TY: "Typhoon",
  STY: "Super Typhoon",
  TC: "Tropical Cyclone",
  PTC: "Potential Tropical Cyclone",
  PTS: "Post-Tropical Cyclone",
  LO: "Low",
  DB: "Disturbance",
  WV: "Tropical Wave",
};

function basinFor(id: string): string {
  const p = id.slice(0, 2).toLowerCase();
  if (p === "al") return "Atlantic";
  if (p === "ep") return "East Pacific";
  if (p === "cp") return "Central Pacific";
  return "Tropical basin";
}

function categoryFor(classification: string, windMph: number | null): string | null {
  if (classification !== "HU" || windMph == null) return null;
  if (windMph >= 157) return "Category 5";
  if (windMph >= 130) return "Category 4";
  if (windMph >= 111) return "Category 3";
  if (windMph >= 96) return "Category 2";
  return "Category 1";
}

function parseTrackFromAdvisory(html: string): { track: z.infer<typeof tropicalTrackPoint>[]; gustKt: number | null } {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  const gustMatch = text.match(/MAX SUSTAINED WINDS\s+(\d+)\s+KT WITH GUSTS TO\s+(\d+)\s+KT/);
  const gustKt = gustMatch ? Number(gustMatch[2]) : null;
  const track: z.infer<typeof tropicalTrackPoint>[] = [];
  const re = /(FORECAST|OUTLOOK)\s+VALID\s+(\d{2})\/(\d{4})Z\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])\s+MAX WIND\s+(\d+)\s+KT/g;
  for (const m of text.matchAll(re)) {
    const kind = m[1] ?? "FORECAST";
    const day = m[2] ?? "";
    const hhmm = m[3] ?? "0000";
    const lat = Number(m[4]) * ((m[5] ?? "N") === "S" ? -1 : 1);
    const lon = Number(m[6]) * ((m[7] ?? "W") === "W" ? -1 : 1);
    const kt = Number(m[8]);
    track.push({
      validLabel: `${kind === "OUTLOOK" ? "Outlook " : ""}Day ${day} · ${hhmm.slice(0, 2)}:${hhmm.slice(2)} UTC`,
      lat,
      lon,
      maxWindKt: Number.isFinite(kt) ? kt : null,
      maxWindMph: Number.isFinite(kt) ? Math.round(kt * 1.15078) : null,
      outlook: kind === "OUTLOOK",
    });
  }
  return { track, gustKt };
}

async function fetchTropicalFresh(): Promise<{ asOf: string; storms: TropicalStorm[] }> {
  const raw = await fetchJson("https://www.nhc.noaa.gov/CurrentStorms.json");
  const root = asRecord(raw);
  const list = Array.isArray(root.activeStorms) ? root.activeStorms : [];
  const storms: TropicalStorm[] = [];
  for (const item of list) {
    const s = asRecord(item);
    const str = (k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "");
    const num = (k: string): number | null => {
      const v = s[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      return null;
    };
    const lat = num("latitudeNumeric");
    const lon = num("longitudeNumeric");
    if (lat == null || lon == null) continue;
    const classification = str("classification") || "TC";
    const intensityKt = num("intensity");
    const windMph = intensityKt != null ? Math.round(intensityKt * 1.15078) : null;
    const movementDir = num("movementDir");
    const movementSpeedKt = num("movementSpeed");
    const sub = (k: string): Record<string, unknown> => asRecord(s[k]);
    const advisoryUrl = typeof sub("publicAdvisory").url === "string" ? (sub("publicAdvisory").url as string) : null;
    const fcstUrl = typeof sub("forecastAdvisory").url === "string" ? (sub("forecastAdvisory").url as string) : null;
    const graphicsUrl = typeof sub("forecastGraphics").url === "string" ? (sub("forecastGraphics").url as string) : null;
    const discussionUrl = typeof sub("forecastDiscussion").url === "string" ? (sub("forecastDiscussion").url as string) : null;

    let track: z.infer<typeof tropicalTrackPoint>[] = [];
    let gustKt: number | null = null;
    if (fcstUrl) {
      try {
        const res = await fetch(fcstUrl, { headers: { ...UA } });
        if (res.ok) {
          const parsed = parseTrackFromAdvisory(await res.text());
          track = parsed.track;
          gustKt = parsed.gustKt;
        }
      } catch { /* track degrades to current position only */ }
    }
    // Prepend the current centre so the plotted track starts at "now".
    track = [
      {
        validLabel: "Now",
        lat,
        lon,
        maxWindKt: intensityKt,
        maxWindMph: windMph,
        outlook: false,
      },
      ...track,
    ];
    storms.push({
      id: str("id"),
      name: str("name") || "Unnamed storm",
      basin: basinFor(str("id")),
      classification,
      classificationLabel: CLASS_LABELS[classification] ?? classification,
      category: categoryFor(classification, windMph),
      intensityKt,
      windMph,
      gustKt,
      gustMph: gustKt != null ? Math.round(gustKt * 1.15078) : null,
      pressureMb: num("pressure"),
      lat,
      lon,
      movementDir,
      movementDirLabel: movementDir != null ? (["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(movementDir / 22.5) % 16] ?? "—") : "—",
      movementSpeedKt,
      movementSpeedMph: movementSpeedKt != null ? Math.round(movementSpeedKt * 1.15078) : null,
      lastUpdate: typeof s.lastUpdate === "string" ? (s.lastUpdate as string) : null,
      track,
      advisoryUrl,
      graphicsUrl,
      discussionUrl,
    });
  }
  // Strongest first.
  storms.sort((a, b) => (b.windMph ?? 0) - (a.windMph ?? 0));
  return { asOf: new Date().toISOString(), storms };
}

const locationResult = z.object({
  name: z.string(),
  region: z.string(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  timezone: z.string(),
});

const savedRow = z.object({
  id: z.number(),
  name: z.string(),
  region: z.string(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  timezone: z.string(),
  isDefault: z.boolean(),
});

export const Actions = {
  getWeather: defineAction({
    request: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      force: z.boolean().default(false),
    }),
    response: getWeatherResponse,
    handler: async (ctx, args): Promise<z.infer<typeof getWeatherResponse>> => {
      const db = ctx.db<typeof schema>();
      const key = cacheKey(args.lat, args.lon);
      const rows = await db.select().from(schema.weatherCache).where(eq(schema.weatherCache.key, key)).limit(1);
      const row = rows[0];
      const fresh = row != null && Date.now() - row.fetchedAt.getTime() < CACHE_MS;
      if (row && fresh && !args.force) {
        try {
          const parsed = weatherPayload.parse(JSON.parse(row.payload));
          return { ok: true, error: null, weather: { ...parsed, cached: true, stale: false, asOf: row.fetchedAt.toISOString() } };
        } catch { /* fall through to refetch */ }
      }
      try {
        const weather = await fetchWeatherFresh(args.lat, args.lon);
        await db
          .insert(schema.weatherCache)
          .values({ key, payload: JSON.stringify(weather), fetchedAt: new Date() })
          .onConflictDoUpdate({ target: schema.weatherCache.key, set: { payload: JSON.stringify(weather), fetchedAt: new Date() } });
        return { ok: true, error: null, weather };
      } catch (err) {
        if (row) {
          try {
            const parsed = weatherPayload.parse(JSON.parse(row.payload));
            return { ok: true, error: null, weather: { ...parsed, cached: true, stale: true, asOf: row.fetchedAt.toISOString() } };
          } catch { /* no usable cache */ }
        }
        return { ok: false, error: err instanceof Error ? err.message : "Weather service unreachable", weather: null };
      }
    },
  }),

  getGlobe: defineAction({
    request: z.object({ force: z.boolean().default(false) }),
    response: globeResponse,
    handler: async (ctx, args): Promise<z.infer<typeof globeResponse>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.weatherCache).where(eq(schema.weatherCache.key, "globe")).limit(1);
      const row = rows[0];
      const fresh = row != null && Date.now() - row.fetchedAt.getTime() < CACHE_MS;
      if (row && fresh && !args.force) {
        try {
          const parsed = globeResponse.parse(JSON.parse(row.payload));
          return { ...parsed, asOf: row.fetchedAt.toISOString() };
        } catch { /* refetch */ }
      }
      try {
        const globe = await fetchGlobeFresh();
        await db
          .insert(schema.weatherCache)
          .values({ key: "globe", payload: JSON.stringify(globe), fetchedAt: new Date() })
          .onConflictDoUpdate({ target: schema.weatherCache.key, set: { payload: JSON.stringify(globe), fetchedAt: new Date() } });
        return globe;
      } catch {
        if (row) {
          try { return globeResponse.parse(JSON.parse(row.payload)); } catch { /* empty */ }
        }
        return { ok: false, asOf: null, points: [] };
      }
    },
  }),

  getRadar: defineAction({
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
      host: z.string().nullable(),
      frames: z.array(z.object({ time: z.number(), path: z.string() })),
      nowcast: z.array(z.object({ time: z.number(), path: z.string() })),
    }),
    async handler() {
      try {
        const root = asRecord(await fetchJson("https://api.rainviewer.com/public/weather-maps.json"));
        const host = typeof root.host === "string" ? root.host : "https://tilecache.rainviewer.com";
        const radar = asRecord(root.radar);
        const parseFrames = (v: unknown): { time: number; path: string }[] =>
          (Array.isArray(v) ? v : [])
            .map((f) => {
              const rec = asRecord(f);
              return {
                time: typeof rec.time === "number" ? rec.time : 0,
                path: typeof rec.path === "string" ? rec.path : "",
              };
            })
            .filter((f) => f.path.length > 0);
        return { ok: true, host, frames: parseFrames(radar.past), nowcast: parseFrames(radar.nowcast) };
      } catch {
        return { ok: false, host: null, frames: [], nowcast: [] };
      }
    },
  }),

  getTropical: defineAction({
    request: z.object({ force: z.boolean().default(false) }),
    response: tropicalResponse,
    handler: async (ctx, args): Promise<z.infer<typeof tropicalResponse>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.weatherCache).where(eq(schema.weatherCache.key, "tropical")).limit(1);
      const row = rows[0];
      const fresh = row != null && Date.now() - row.fetchedAt.getTime() < CACHE_MS;
      if (row && fresh && !args.force) {
        try {
          const parsed = tropicalResponse.parse(JSON.parse(row.payload));
          return { ...parsed, cached: true, stale: false, asOf: row.fetchedAt.toISOString() };
        } catch { /* refetch */ }
      }
      try {
        const data = await fetchTropicalFresh();
        const payload: z.infer<typeof tropicalResponse> = {
          ok: true, error: null, asOf: data.asOf, cached: false, stale: false, storms: data.storms,
        };
        await db
          .insert(schema.weatherCache)
          .values({ key: "tropical", payload: JSON.stringify(payload), fetchedAt: new Date() })
          .onConflictDoUpdate({ target: schema.weatherCache.key, set: { payload: JSON.stringify(payload), fetchedAt: new Date() } });
        return payload;
      } catch (err) {
        if (row) {
          try {
            const parsed = tropicalResponse.parse(JSON.parse(row.payload));
            return { ...parsed, cached: true, stale: true, asOf: row.fetchedAt.toISOString() };
          } catch { /* no usable cache */ }
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : "National Hurricane Center feed unreachable",
          asOf: null, cached: false, stale: false, storms: [],
        };
      }
    },
  }),

  searchLocations: defineAction({
    request: z.object({ query: z.string().min(2).max(80) }),
    response: z.object({ results: z.array(locationResult) }),
    async handler(_ctx, args) {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.query)}&count=8&language=en&format=json`;
        const root = asRecord(await fetchJson(url));
        const list = Array.isArray(root.results) ? root.results : [];
        return {
          results: list.map((r) => {
            const rec = asRecord(r);
            const s = (k: string): string => (typeof rec[k] === "string" ? (rec[k] as string) : "");
            return {
              name: s("name"),
              region: s("admin1"),
              country: s("country"),
              lat: typeof rec.latitude === "number" ? rec.latitude : 0,
              lon: typeof rec.longitude === "number" ? rec.longitude : 0,
              timezone: s("timezone") || "auto",
            };
          }).filter((r) => r.name.length > 0),
        };
      } catch {
        return { results: [] };
      }
    },
  }),

  reverseGeocode: defineAction({
    request: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }),
    response: z.object({
      name: z.string(),
      region: z.string(),
      country: z.string(),
      timezone: z.string(),
    }),
    async handler(_ctx, args) {
      // Nominatim reverse geocoding (OpenStreetMap) — no key required.
      // Falls back to a generic label so device location still works
      // even if the geocoder is unreachable.
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${args.lat}&lon=${args.lon}&format=jsonv2&zoom=14&addressdetails=1`;
        const res = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
        if (!res.ok) throw new Error(`Nominatim ${res.status}`);
        const root = asRecord(await res.json());
        const addr = asRecord(root.address);
        const s = (k: string): string => (typeof addr[k] === "string" ? (addr[k] as string) : "");
        const name =
          s("village") || s("town") || s("city") || s("hamlet") || s("municipality") || s("county") || "Current location";
        const region = s("state") || s("county") || "";
        const country = s("country") || "";
        return { name, region, country, timezone: "auto" };
      } catch {
        return { name: "Current location", region: "", country: "", timezone: "auto" };
      }
    },
  }),

  listSaved: defineAction({
    request: z.object({}),
    response: z.object({ locations: z.array(savedRow) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.savedLocations).orderBy(asc(schema.savedLocations.id));
      return {
        locations: rows.map((r) => ({
          id: r.id, name: r.name, region: r.region, country: r.country,
          lat: r.lat, lon: r.lon, timezone: r.timezone, isDefault: r.isDefault === 1,
        })),
      };
    },
  }),

  saveLocation: defineAction({
    request: z.object({
      name: z.string().min(1).max(120),
      region: z.string().max(120).default(""),
      country: z.string().max(120).default(""),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      timezone: z.string().max(80).default("auto"),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.savedLocations);
      const dupe = existing.find(
        (r) => Math.abs(r.lat - args.lat) < 0.01 && Math.abs(r.lon - args.lon) < 0.01,
      );
      if (dupe) return { id: dupe.id };
      const result = await db
        .insert(schema.savedLocations)
        .values({
          name: args.name, region: args.region, country: args.country,
          lat: args.lat, lon: args.lon, timezone: args.timezone,
          isDefault: existing.length === 0 ? 1 : 0,
        })
        .returning({ id: schema.savedLocations.id });
      const inserted = result[0];
      if (!inserted) throw new Error("saveLocation: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  removeLocation: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.savedLocations).where(eq(schema.savedLocations.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setDefaultLocation: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    handler: async (ctx, args): Promise<{ ok: true }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.savedLocations);
      for (const r of rows) {
        await db
          .update(schema.savedLocations)
          .set({ isDefault: r.id === args.id ? 1 : 0 })
          .where(eq(schema.savedLocations.id, r.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;

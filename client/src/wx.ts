// Weather helpers: WMO code labels, unit conversion, formatting.
// All forecast values arrive from the server in °F / mph / inches.

export type Units = "imperial" | "metric";

export interface Place {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
}

export const HOME: Place = {
  name: "New York City",
  region: "New York",
  country: "United States",
  lat: 40.7128,
  lon: -74.006,
  timezone: "America/New_York",
};

/** Saffir–Simpson / tropical category color. */
export function tropicalColor(category: string | null, classification: string): string {
  if (category === "Category 5") return "#c084fc";
  if (category === "Category 4") return "#f4536a";
  if (category === "Category 3") return "#fb923c";
  if (category === "Category 2") return "#facc15";
  if (category === "Category 1") return "#fde68a";
  if (classification === "TS" || classification === "STS") return "#38bdf8";
  return "#8ca0bc";
}

export function formatLatLon(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Clear sky", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Rime fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Dense drizzle", icon: "🌦️" },
  56: { label: "Freezing drizzle", icon: "🌧️" },
  57: { label: "Freezing drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌧️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "🌧️" },
  66: { label: "Freezing rain", icon: "🧊" },
  67: { label: "Freezing rain", icon: "🧊" },
  71: { label: "Light snow", icon: "🌨️" },
  73: { label: "Snow", icon: "🌨️" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨️" },
  80: { label: "Light showers", icon: "🌦️" },
  81: { label: "Showers", icon: "🌦️" },
  82: { label: "Violent showers", icon: "⛈️" },
  85: { label: "Snow showers", icon: "🌨️" },
  86: { label: "Snow showers", icon: "🌨️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Thunderstorm, hail", icon: "⛈️" },
  99: { label: "Thunderstorm, heavy hail", icon: "⛈️" },
};

export function codeInfo(code: number | null | undefined): { label: string; icon: string } {
  if (code == null) return { label: "—", icon: "·" };
  return WMO[code] ?? { label: `Code ${code}`, icon: "·" };
}

export function isThunder(code: number | null | undefined): boolean {
  return code === 95 || code === 96 || code === 99;
}
export function isSnow(code: number | null | undefined): boolean {
  return code != null && [71, 73, 75, 77, 85, 86].includes(code);
}
export function isFreezing(code: number | null | undefined): boolean {
  return code != null && [56, 57, 66, 67].includes(code);
}

export function temp(v: number | null | undefined, units: Units): string {
  if (v == null) return "—";
  const n = units === "imperial" ? v : ((v - 32) * 5) / 9;
  return `${Math.round(n)}°`;
}
export function tempVal(v: number, units: Units): number {
  return units === "imperial" ? v : ((v - 32) * 5) / 9;
}
export function speed(v: number | null | undefined, units: Units): string {
  if (v == null) return "—";
  return units === "imperial" ? `${Math.round(v)} mph` : `${Math.round(v * 1.60934)} km/h`;
}
export function precip(v: number | null | undefined, units: Units): string {
  if (v == null) return "—";
  return units === "imperial" ? `${v.toFixed(2)} in` : `${(v * 25.4).toFixed(1)} mm`;
}
/** Open-Meteo snowfall values are always centimeters. */
export function snowAmt(cm: number | null | undefined, units: Units): string {
  if (cm == null) return "—";
  return units === "imperial" ? `${(cm / 2.54).toFixed(1)} in` : `${cm.toFixed(1)} cm`;
}
export function visib(meters: number | null | undefined, units: Units): string {
  if (meters == null) return "—";
  return units === "imperial" ? `${(meters / 1609.34).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;
}

const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compass(deg: number | null | undefined): string {
  if (deg == null) return "—";
  return DIRS[Math.round(deg / 22.5) % 16] ?? "—";
}

/** "2026-10-24T05:00" (location-local wall time) → "5 AM" */
export function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  if (!Number.isFinite(h)) return iso.slice(11, 16);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const part = iso.slice(11, 16);
  const [hh = "0", mm = "00"] = part.split(":");
  const h = Number(hh);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function weekday(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? "";
}
export function shortDate(dateStr: string): string {
  const [, m = 1, d = 1] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

export function formatAsOf(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function aqiCategory(aqi: number | null | undefined): { label: string; color: string } {
  if (aqi == null) return { label: "Unavailable", color: "#8CA0BC" };
  if (aqi <= 50) return { label: "Good", color: "#4ADE80" };
  if (aqi <= 100) return { label: "Moderate", color: "#FACC15" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "#FB923C" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#F87171" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#C084FC" };
  return { label: "Hazardous", color: "#F4536A" };
}

export function uvCategory(uv: number | null | undefined): string {
  if (uv == null) return "—";
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

export function pollenLevel(v: number | null | undefined): string {
  if (v == null) return "No data";
  if (v <= 0) return "None";
  if (v < 10) return "Low";
  if (v < 50) return "Moderate";
  if (v < 200) return "High";
  return "Very high";
}

/** Temperature color scale (°F) shared by the globe legend and dots. */
export function tempColor(f: number): string {
  const stops: [number, [number, number, number]][] = [
    [-20, [147, 51, 234]],
    [0, [59, 130, 246]],
    [25, [56, 189, 248]],
    [45, [74, 222, 128]],
    [65, [250, 204, 21]],
    [85, [249, 115, 22]],
    [105, [239, 68, 68]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1]!;
    const [t2, c2] = stops[i]!;
    if (f <= t2 || i === stops.length - 1) {
      const k = Math.min(1, Math.max(0, (f - t1) / (t2 - t1)));
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * k);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * k);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * k);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(56,189,248)";
}

import { useEffect, useRef } from "react";
import { tempColor, type Place } from "./wx";
import { LAND } from "./land";

export type GlobeLayer = "temp" | "wind" | "precip" | "cloud";

export interface GlobePoint {
  lat: number;
  lon: number;
  temp: number | null;
  windSpeed: number | null;
  windDir: number | null;
  precip: number | null;
  cloud: number | null;
  code: number | null;
}

const LAYER_META: Record<GlobeLayer, { label: string; min: string; max: string; gradient: string }> = {
  temp: {
    label: "Temperature",
    min: "-20°F",
    max: "105°F",
    gradient: "linear-gradient(90deg,#9333ea,#3b82f6,#38bdf8,#4ade80,#facc15,#f97316,#ef4444)",
  },
  wind: {
    label: "Wind speed",
    min: "0 mph",
    max: "60+ mph",
    gradient: "linear-gradient(90deg,#164e63,#0e7490,#22d3ee,#a5f3fc)",
  },
  precip: {
    label: "Precipitation",
    min: "Dry",
    max: "1+ in/hr",
    gradient: "linear-gradient(90deg,#1e3a2f,#166534,#22c55e,#38bdf8,#818cf8)",
  },
  cloud: {
    label: "Cloud cover",
    min: "0%",
    max: "100%",
    gradient: "linear-gradient(90deg,#1e293b,#475569,#94a3b8,#f1f5f9)",
  },
};

export function layerMeta(layer: GlobeLayer) {
  return LAYER_META[layer];
}

function pointColor(p: GlobePoint, layer: GlobeLayer): string | null {
  switch (layer) {
    case "temp":
      return p.temp == null ? null : tempColor(p.temp);
    case "wind": {
      if (p.windSpeed == null) return null;
      const k = Math.min(1, p.windSpeed / 60);
      return `rgba(${Math.round(34 + k * 130)},${Math.round(211 - k * 60)},${Math.round(238 - k * 100)},${0.55 + k * 0.45})`;
    }
    case "precip": {
      if (p.precip == null) return null;
      if (p.precip <= 0) return "rgba(120,150,190,0.20)";
      const k = Math.min(1, p.precip / 0.6);
      return `rgba(${Math.round(34 + k * 60)},${Math.round(197 - k * 60)},${Math.round(94 + k * 150)},${0.5 + k * 0.5})`;
    }
    case "cloud": {
      if (p.cloud == null) return null;
      const a = 0.10 + (p.cloud / 100) * 0.75;
      return `rgba(226,236,248,${a.toFixed(2)})`;
    }
  }
}

function pointRadius(p: GlobePoint, layer: GlobeLayer, base: number): number {
  if (layer === "precip") return p.precip != null && p.precip > 0 ? base * 1.5 : base * 0.6;
  if (layer === "wind") return base * (0.8 + Math.min(1, (p.windSpeed ?? 0) / 50) * 0.9);
  return base;
}

/**
 * Real continent geometry lives in ./land (bundled with the app):
 * Meta's published country-boundary GeoJSON, simplified at build time.
 * It is drawn as filled landmasses under the data dots — without it the
 * globe was just dots floating on a blank sphere. Bundled rather than
 * fetched so the continents render even where a runtime fetch to the
 * boundary CDN would be blocked.
 */

/** Subsolar point for the day/night terminator, from the current UTC time. */
function sunVector(now: Date): [number, number, number] {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = Math.floor((now.getTime() - start) / 86400000);
  const decl = -23.44 * Math.cos(((doy + 10) / 365) * 2 * Math.PI) * (Math.PI / 180);
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const sunLon = ((12 - utcHours) * 15) * (Math.PI / 180);
  return [Math.cos(decl) * Math.cos(sunLon), Math.cos(decl) * Math.sin(sunLon), Math.sin(decl)];
}

export interface GlobeStorm {
  name: string;
  category: string | null;
  classificationLabel: string;
  lat: number;
  lon: number;
  track: { lat: number; lon: number }[];
}

export function Globe({
  points,
  layer,
  place,
  storms = [],
}: {
  points: GlobePoint[];
  layer: GlobeLayer;
  place: Place;
  storms?: GlobeStorm[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotRef = useRef({ lon: -place.lon, lat: 18 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const idleRef = useRef(0);
  const dataRef = useRef({ points, layer, place, storms });
  dataRef.current = { points, layer, place, storms };

  useEffect(() => {
    rotRef.current.lon = -place.lon;
  }, [place]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    let raf = 0;
    let last = performance.now();

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(100, nowMs - last);
      last = nowMs;
      idleRef.current += dt;
      if (!dragRef.current && idleRef.current > 2500) {
        rotRef.current.lon += dt * 0.004; // slow idle spin
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = canvas.clientWidth;
      if (size === 0) return;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      const c = ctx2d;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const R = size / 2 - 6;

      const rotLon = (rotRef.current.lon * Math.PI) / 180;
      const rotLat = (rotRef.current.lat * Math.PI) / 180;
      const cosRLat = Math.cos(rotLat);
      const sinRLat = Math.sin(rotLat);

      const project = (latDeg: number, lonDeg: number): [number, number, number] => {
        const la = (latDeg * Math.PI) / 180;
        const lo = (lonDeg * Math.PI) / 180 + rotLon;
        const x = Math.cos(la) * Math.sin(lo);
        const y0 = Math.sin(la);
        const z0 = Math.cos(la) * Math.cos(lo);
        const y = y0 * cosRLat - z0 * sinRLat;
        const z = y0 * sinRLat + z0 * cosRLat;
        return [cx + x * R, cy - y * R, z];
      };

      // Ocean sphere
      const ocean = c.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
      ocean.addColorStop(0, "#1d3a5f");
      ocean.addColorStop(0.6, "#12283f");
      ocean.addColorStop(1, "#0a1626");
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.fillStyle = ocean;
      c.fill();

      c.save();
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.clip();

      // Graticule
      c.strokeStyle = "rgba(140,170,220,0.16)";
      c.lineWidth = 1;
      for (let la = -75; la <= 75; la += 15) {
        c.beginPath();
        let started = false;
        for (let lo = -180; lo <= 180; lo += 4) {
          const [x, y, z] = project(la, lo);
          if (z > 0) {
            if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
          } else started = false;
        }
        c.stroke();
      }
      for (let lo = -180; lo < 180; lo += 15) {
        c.beginPath();
        let started = false;
        for (let la = -90; la <= 90; la += 4) {
          const [x, y, z] = project(la, lo);
          if (z > 0) {
            if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
          } else started = false;
        }
        c.stroke();
      }

      // Continents: filled country-boundary landmasses, so the data dots
      // sit on an actual Earth instead of a blank dotted sphere. Rings
      // are drawn as runs of front-facing points (decimated to ~1px) and
      // filled even-odd so islands and holes come out right.
      const land = LAND;
      if (typeof Path2D !== "undefined") {
        const landPath = new Path2D();
        for (const poly of land) {
          for (const ring of poly) {
            let started = false;
            let lx = 0;
            let ly = 0;
            for (const [ptLon, ptLat] of ring) {
              const [x, y, z] = project(ptLat, ptLon);
              if (z <= 0.005) {
                started = false;
                continue;
              }
              if (!started) {
                landPath.moveTo(x, y);
                started = true;
                lx = x;
                ly = y;
              } else if ((x - lx) * (x - lx) + (y - ly) * (y - ly) >= 1.2) {
                landPath.lineTo(x, y);
                lx = x;
                ly = y;
              }
            }
          }
        }
        c.fillStyle = "#3c6a4c";
        c.fill(landPath, "evenodd");
        c.strokeStyle = "rgba(178,226,192,0.55)";
        c.lineWidth = 0.7;
        c.stroke(landPath);
      }

      const { points: pts, layer: activeLayer, place: pl } = dataRef.current;
      const sun = sunVector(new Date());

      // Night shading over the land: a soft shadow centred on the
      // anti-sun point, so the night side of the continents reads as
      // night (the data dots are also dimmed individually below).
      {
        const sunLat = (Math.asin(Math.max(-1, Math.min(1, sun[2] ?? 0))) * 180) / Math.PI;
        const sunLon = (Math.atan2(sun[1] ?? 0, sun[0] ?? 0) * 180) / Math.PI;
        const [ax, ay] = project(-sunLat, sunLon + 180);
        const nightGrad = c.createRadialGradient(ax, ay, R * 0.1, ax, ay, R * 1.55);
        nightGrad.addColorStop(0, "rgba(2,6,16,0.52)");
        nightGrad.addColorStop(0.55, "rgba(2,6,16,0.26)");
        nightGrad.addColorStop(1, "rgba(2,6,16,0)");
        c.fillStyle = nightGrad;
        c.fillRect(cx - R, cy - R, R * 2, R * 2);
      }

      // Data dots (night side dimmed by the terminator)
      const baseR = Math.max(3, R / 42);
      for (const p of pts) {
        const [x, y, z] = project(p.lat, p.lon);
        if (z <= 0.02) continue;
        const la = (p.lat * Math.PI) / 180;
        const lo = (p.lon * Math.PI) / 180;
        const dot = Math.cos(la) * Math.cos(lo) * sun[0] + Math.cos(la) * Math.sin(lo) * sun[1] + Math.sin(la) * sun[2];
        const night = dot < 0;
        const color = pointColor(p, activeLayer);
        if (!color) continue;
        c.globalAlpha = (night ? 0.45 : 0.95) * Math.min(1, 0.35 + z);
        c.beginPath();
        c.arc(x, y, pointRadius(p, activeLayer, baseR), 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        // Wind barbs: short heading ticks
        if (activeLayer === "wind" && p.windDir != null && (p.windSpeed ?? 0) > 3) {
          const [ex, ey] = project(p.lat, p.lon + 6);
          const [nx, ny] = project(p.lat + 6, p.lon);
          const rad = ((p.windDir + 180) * Math.PI) / 180; // direction wind blows toward
          const vx = (ex - x) * Math.sin(rad) + (nx - x) * Math.cos(rad);
          const vy = (ey - y) * Math.sin(rad) + (ny - y) * Math.cos(rad);
          const len = Math.hypot(vx, vy) || 1;
          const L = baseR * 2.4;
          c.globalAlpha = 0.9;
          c.strokeStyle = "#cffafe";
          c.lineWidth = 1.4;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + (vx / len) * L, y + (vy / len) * L);
          c.stroke();
        }
      }
      c.globalAlpha = 1;

      // Tropical storms: forecast track + centre (NHC live data)
      const { storms: activeStorms } = dataRef.current;
      for (const st of activeStorms) {
        // Track line
        c.lineWidth = 2;
        c.strokeStyle = "rgba(244,83,106,0.9)";
        c.setLineDash([5, 3]);
        c.beginPath();
        let pen = false;
        for (const tp of st.track) {
          const [tx, ty, tz] = project(tp.lat, tp.lon);
          if (tz > 0.02) {
            if (!pen) { c.moveTo(tx, ty); pen = true; } else c.lineTo(tx, ty);
          } else pen = false;
        }
        c.stroke();
        c.setLineDash([]);
        // Track dots
        for (const tp of st.track) {
          const [tx, ty, tz] = project(tp.lat, tp.lon);
          if (tz <= 0.02) continue;
          c.beginPath();
          c.arc(tx, ty, 2.6, 0, Math.PI * 2);
          c.fillStyle = "#fda4af";
          c.fill();
        }
        // Storm centre
        const [sx, sy, sz] = project(st.lat, st.lon);
        if (sz > 0.02) {
          const pulse = 1 + 0.22 * Math.sin(nowMs / 320);
          c.beginPath();
          c.arc(sx, sy, 10 * pulse, 0, Math.PI * 2);
          c.strokeStyle = "#f4536a";
          c.lineWidth = 2.2;
          c.stroke();
          c.beginPath();
          c.arc(sx, sy, 4.2, 0, Math.PI * 2);
          c.fillStyle = "#f4536a";
          c.fill();
          c.font = "bold 11px sans-serif";
          c.fillStyle = "#ffe4e6";
          c.strokeStyle = "rgba(6,12,24,0.8)";
          c.lineWidth = 3;
          const label = st.category ? `${st.name} · ${st.category.replace("Category ", "Cat ")}` : st.name;
          c.strokeText(label, sx + 13, sy + 4);
          c.fillText(label, sx + 13, sy + 4);
        }
      }

      // Selected place marker
      const [mx, my, mz] = project(pl.lat, pl.lon);
      if (mz > 0) {
        const pulse = 1 + 0.25 * Math.sin(nowMs / 350);
        c.beginPath();
        c.arc(mx, my, 7 * pulse, 0, Math.PI * 2);
        c.strokeStyle = "#f5a623";
        c.lineWidth = 2;
        c.stroke();
        c.beginPath();
        c.arc(mx, my, 3, 0, Math.PI * 2);
        c.fillStyle = "#f5a623";
        c.fill();
      }
      c.restore();

      // Rim
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.strokeStyle = "rgba(120,170,240,0.45)";
      c.lineWidth = 1.5;
      c.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    idleRef.current = 0;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    idleRef.current = 0;
    rotRef.current.lon += (e.clientX - d.x) * 0.35;
    rotRef.current.lat = Math.max(-65, Math.min(65, rotRef.current.lat + (e.clientY - d.y) * 0.25));
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    dragRef.current = null;
    idleRef.current = 0;
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Interactive 3D globe showing the ${LAYER_META[layer].label.toLowerCase()} layer. Drag to rotate.`}
      className="block aspect-square w-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

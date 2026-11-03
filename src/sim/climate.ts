// Climate from latitude plus orographic rain and rain shadow.
import { boxBlur, clamp, TerrainInput } from './grid';

/** Annual mean sea-level temperature (deg C) as a function of latitude. */
export function seaLevelTemp(latDeg: number): number {
  const a = Math.abs(latDeg);
  return 28 - 0.0068 * a * a;
}

/** Zonal precipitation baseline (mm/yr): wet equator, dry subtropics, wet mid-latitudes. */
export function zonalPrecip(latDeg: number): number {
  const a = Math.abs(latDeg);
  const p = 450 + 1700 * Math.exp(-Math.pow(a / 11, 2)) + 650 * Math.exp(-Math.pow((a - 50) / 13, 2))
    - 380 * Math.exp(-Math.pow((a - 26) / 7, 2));
  return Math.max(60, p);
}

export function latitudeOfRow(t: TerrainInput, y: number): number {
  return t.latTop + (t.latBottom - t.latTop) * (y / Math.max(1, t.H - 1));
}

export interface Climate { temp: Float32Array; precip: Float32Array; }

export function computeClimate(t: TerrainInput, water: Uint8Array): Climate {
  const { W, H, elev, cellKm } = t;
  const N = W * H;
  const temp = new Float32Array(N);
  const precip = new Float32Array(N);
  const latMid = (t.latTop + t.latBottom) / 2;
  let windFromWest: boolean;
  if (t.wind === 'west') windFromWest = true;
  else if (t.wind === 'east') windFromWest = false;
  else windFromWest = Math.abs(latMid) >= 30; // westerlies vs trade winds

  // Moisture advection along rows in the wind direction.
  const stepKm = cellKm;
  for (let y = 0; y < H; y++) {
    const lat = latitudeOfRow(t, y);
    const base = zonalPrecip(lat);
    let m = 0.85; // incoming air moisture
    for (let s = 0; s < W; s++) {
      const x = windFromWest ? s : W - 1 - s;
      const i = y * W + x;
      const e = Math.max(0, elev[i]);
      temp[i] = seaLevelTemp(lat) - 0.0065 * e;
      if (water[i]) {
        m += (1 - m) * Math.min(1, 0.05 * stepKm); // recharge over water
        precip[i] = base * m;
        continue;
      }
      const px = windFromWest ? x - 1 : x + 1;
      const prev = px >= 0 && px < W ? Math.max(0, elev[y * W + px]) : e;
      const uplift = Math.max(0, e - prev) / (stepKm * 1000); // gradient
      const oro = Math.min(3, uplift * 260);
      const rain = base * m * (0.85 + oro);
      precip[i] = rain;
      // Moisture loss: gentle decay inland + strong loss on windward slopes.
      const loss = 0.0007 * stepKm + oro * 0.045;
      // evapotranspiration recycles some moisture back into the air mass
      m = clamp(m * (1 - loss) + 0.00035 * stepKm, 0.22, 1);
    }
  }
  const p2 = boxBlur(precip, W, H, Math.max(1, Math.round(6 / cellKm)), 2);
  const scale = t.precipScale ?? 1;
  for (let i = 0; i < N; i++) precip[i] = Math.max(5, p2[i] * scale);
  return { temp, precip };
}

/** Potential evapotranspiration (mm/yr), crude temperature-driven estimate. */
export function evapotranspiration(tempC: number): number {
  return clamp(250 + 32 * tempC, 120, 1300);
}

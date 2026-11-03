// Geometry and hydrology settings for the curated Earth Mode regions.
// Used by the build script (scripts/build-regions.ts) and by the app.

export interface Inflow { name: string; lon: number; lat: number; q: number } // q: mean discharge m3/s entering from off-map

export interface RegionDef {
  id: string;
  name: string;
  bbox: [number, number, number, number]; // west, south, east, north
  maxCells: number; // cells along the longer side
  precipScale: number; // climate calibration (1 = model default)
  precipBase: number; // typical annual precipitation upwind (mm/yr), replaces the zonal estimate
  wind?: 'west' | 'east' | 'auto' | 'none'; // 'none': moisture arrives from several sides (no rain shadow)
  inflows: Inflow[];
  riverRank: number; // burn Natural Earth rivers with scalerank <= this
  resources?: { kind: 'ore' | 'coal' | 'salt' | 'stone' | 'timber' | 'gold'; lon: number; lat: number; name: string }[];
}

export const REGION_DEFS: RegionDef[] = [
  {
    id: 'nile', name: 'The Nile valley and delta', bbox: [28.6, 22.5, 34.2, 31.7], maxCells: 300, precipScale: 1, precipBase: 30, wind: 'east', riverRank: 9,
    // Natural (pre-Aswan High Dam) mean flow of the Nile is roughly 2,800 m3/s.
    inflows: [{ name: 'Nile', lon: 31.45, lat: 22.55, q: 2800 }],
    resources: [{ kind: 'stone', lon: 32.9, lat: 24.08, name: 'Aswan granite' }],
  },
  {
    id: 'rhine', name: 'The Rhine', bbox: [3.6, 46.6, 10.4, 52.5], maxCells: 320, precipScale: 1, precipBase: 850, riverRank: 9,
    inflows: [{ name: 'Main', lon: 10.35, lat: 50.05, q: 110 }],
    resources: [{ kind: 'coal', lon: 7.2, lat: 51.48, name: 'Ruhr coalfield' }, { kind: 'coal', lon: 7.0, lat: 49.25, name: 'Saar coalfield' }, { kind: 'ore', lon: 6.1, lat: 49.4, name: 'Lorraine iron ore (minette)' }],
  },
  {
    id: 'missohio', name: 'The Mississippi and the Ohio', bbox: [-92.6, 29.0, -82.0, 42.1], maxCells: 320, precipScale: 1, precipBase: 1200, wind: 'none', riverRank: 8,
    inflows: [
      { name: 'Upper Mississippi', lon: -91.2, lat: 42.05, q: 2000 },
      { name: 'Missouri', lon: -92.55, lat: 38.7, q: 2000 },
      { name: 'Arkansas', lon: -92.55, lat: 34.7, q: 1100 },
    ],
    resources: [{ kind: 'coal', lon: -80.3, lat: 40.2, name: 'Pittsburgh coal seam' }, { kind: 'coal', lon: -87.3, lat: 38.3, name: 'Illinois basin coal' }, { kind: 'ore', lon: -86.8, lat: 33.5, name: 'Birmingham iron ore' }],
  },
  {
    id: 'fallline', name: 'The US East Coast fall line', bbox: [-82.6, 33.0, -73.6, 41.2], maxCells: 320, precipScale: 1, precipBase: 1150, wind: 'none', riverRank: 9,
    inflows: [],
    resources: [{ kind: 'coal', lon: -76.3, lat: 40.8, name: 'Pennsylvania anthracite' }],
  },
  {
    id: 'mesopotamia', name: 'Mesopotamia', bbox: [38.6, 29.2, 49.0, 37.4], maxCells: 320, precipScale: 1, precipBase: 300, riverRank: 9,
    inflows: [{ name: 'Euphrates', lon: 38.65, lat: 36.0, q: 750 }, { name: 'Tigris', lon: 42.3, lat: 37.35, q: 500 }],
    resources: [],
  },
  {
    id: 'japan', name: 'Central Japan', bbox: [129.8, 32.4, 141.2, 37.6], maxCells: 320, precipScale: 1, precipBase: 1700, wind: 'none', riverRank: 10,
    inflows: [],
    resources: [{ kind: 'coal', lon: 130.7, lat: 33.7, name: 'Chikuhō coalfield' }],
  },
  {
    id: 'greatlakes', name: 'The Great Lakes', bbox: [-92.6, 40.6, -75.4, 47.6], maxCells: 320, precipScale: 1, precipBase: 850, wind: 'none', riverRank: 8,
    inflows: [],
    resources: [{ kind: 'ore', lon: -92.3, lat: 47.5, name: 'Mesabi iron range (edge)' }, { kind: 'ore', lon: -87.6, lat: 46.5, name: 'Marquette iron range' }, { kind: 'coal', lon: -80.4, lat: 40.7, name: 'Pittsburgh coal (edge)' }],
  },
  {
    id: 'andes', name: 'The Central Andes', bbox: [-80.5, -19.6, -64.5, -6.0], maxCells: 300, precipScale: 1, precipBase: 1400, wind: 'east', riverRank: 9,
    inflows: [],
    resources: [{ kind: 'ore', lon: -65.75, lat: -19.58, name: 'Potosí silver (edge)' }, { kind: 'ore', lon: -76.25, lat: -10.68, name: 'Cerro de Pasco silver' }],
  },
  {
    id: 'lowcountries', name: 'The Low Countries', bbox: [2.4, 49.5, 7.4, 53.6], maxCells: 300, precipScale: 1, precipBase: 800, riverRank: 10,
    inflows: [{ name: 'Rhine', lon: 7.35, lat: 51.5, q: 2200 }, { name: 'Meuse', lon: 4.85, lat: 49.55, q: 150 }],
    resources: [{ kind: 'coal', lon: 3.9, lat: 50.45, name: 'Borinage / Hainaut coal' }, { kind: 'coal', lon: 5.55, lat: 50.62, name: 'Liège coal' }],
  },
  {
    id: 'yangtze', name: 'The Yangtze', bbox: [103.6, 27.2, 122.4, 33.4], maxCells: 330, precipScale: 1, precipBase: 1250, wind: 'east', riverRank: 9,
    inflows: [{ name: 'Jinsha (upper Yangtze)', lon: 103.65, lat: 28.3, q: 4500 }],
    resources: [],
  },
];

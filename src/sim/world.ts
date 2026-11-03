// Builds a fully derived World from raw terrain input.
import { HydroFeature, TerrainInput, World } from './grid';
import { computeHydrology } from './hydrology';
import { computeLayers, placeResources } from './layers';

export function buildWorld(t: TerrainInput, seed: number, keepResources = false): World {
  const N = t.W * t.H;
  const elev = Float32Array.from(t.elev);
  const input: TerrainInput = { ...t, elev };
  const h = computeHydrology(input, seed);
  const layers = computeLayers(input, h);
  const resources = keepResources && t.resources
    ? t.resources.filter((r) => !h.water[r.cell])
    : [...placeResources(input, h, layers, seed), ...(t.resources?.filter((r) => r.placedByPlayer && !h.water[r.cell]) ?? [])];
  const featureAt = new Map<number, HydroFeature[]>();
  for (const f of h.features) {
    const l = featureAt.get(f.cell);
    if (l) l.push(f); else featureAt.set(f.cell, [f]);
  }
  return {
    ...input,
    N,
    ...h,
    ...layers,
    featureAt,
    resources,
  };
}

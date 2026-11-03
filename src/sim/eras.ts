// Technology eras. Each era changes how expensive it is to move goods over
// land, along rivers and by sea, how many people a farm can feed and how
// much of the population lives off trade and industry rather than farming.
import type { EraId, GrowthKey } from './types';

export interface EraDef {
  id: EraId;
  name: string;
  blurb: string;
  startYear: number;
  land: number; // cost per km on flat open ground
  slopeK: number; // cost *= 1 + slopeK * grade
  forest: number; // multiplier in dense forest
  marsh: number;
  road: [number, number, number]; // multipliers for track, road, highway
  rail: number; // cost per km along a railway (0 = none yet)
  riverDown: number;
  riverUp: number;
  lake: number;
  seaCoastal: number;
  seaOpen: number;
  transfer: number; // fixed cost to load/unload between land and water (km-equivalents)
  cross: number; // scale of river-crossing cost without a bridge
  locks: boolean; // canal locks let boats pass falls
  farmDensity: number; // rural people per km2 at fertility 1
  urbanShare: number; // fraction of people living off non-farm work
  overseas: number; // strength of trade with lands beyond the sea
  marketRangeKm: number;
  weights: Record<Exclude<GrowthKey, 'farming'>, number>;
  resourceDemand: Record<string, number>;
}

export const ERAS: EraDef[] = [
  {
    id: 0, name: 'Foot & Ox', startYear: 0,
    blurb: 'Goods move on human backs, pack animals and ox carts. Rivers are the only easy highways; the sea is for short coastal hops.',
    land: 1.0, slopeK: 28, forest: 1.8, marsh: 2.5, road: [0.8, 0.62, 0.55], rail: 0,
    riverDown: 0.28, riverUp: 0.7, lake: 0.35, seaCoastal: 0.4, seaOpen: 2.5, transfer: 7, cross: 1.0, locks: false,
    farmDensity: 14, urbanShare: 0.08, overseas: 0.0, marketRangeKm: 12,
    weights: { market: 0.55, trade: 0.15, transfer: 0.1, through: 0.06, industry: 0, resource: 0.09, admin: 0.05 },
    resourceDemand: { ore: 0.4, coal: 0, salt: 1.0, stone: 0.4, timber: 0.4, gold: 0.5 },
  },
  {
    id: 1, name: 'Horse & Sail', startYear: 500,
    blurb: 'Horses, wagons and ocean-going sailing ships. Sea trade becomes cheap; ports and river mouths boom.',
    land: 0.75, slopeK: 24, forest: 1.5, marsh: 2.0, road: [0.75, 0.52, 0.42], rail: 0,
    riverDown: 0.2, riverUp: 0.5, lake: 0.22, seaCoastal: 0.13, seaOpen: 0.13, transfer: 5, cross: 0.8, locks: false,
    farmDensity: 20, urbanShare: 0.13, overseas: 0.6, marketRangeKm: 15,
    weights: { market: 0.36, trade: 0.24, transfer: 0.2, through: 0.06, industry: 0, resource: 0.1, admin: 0.04 },
    resourceDemand: { ore: 0.6, coal: 0.1, salt: 0.8, stone: 0.4, timber: 0.9, gold: 1.4 },
  },
  {
    id: 2, name: 'Canal', startYear: 1000,
    blurb: 'Locks tame the falls and canals join river systems. Early industry gathers where water transport is cheapest.',
    land: 0.62, slopeK: 22, forest: 1.3, marsh: 1.6, road: [0.7, 0.45, 0.35], rail: 0,
    riverDown: 0.16, riverUp: 0.26, lake: 0.16, seaCoastal: 0.1, seaOpen: 0.1, transfer: 4.5, cross: 0.6, locks: true,
    farmDensity: 26, urbanShare: 0.18, overseas: 0.8, marketRangeKm: 18,
    weights: { market: 0.27, trade: 0.24, transfer: 0.18, through: 0.05, industry: 0.12, resource: 0.1, admin: 0.04 },
    resourceDemand: { ore: 0.8, coal: 0.7, salt: 0.5, stone: 0.5, timber: 0.8, gold: 1.0 },
  },
  {
    id: 3, name: 'Rail', startYear: 1200,
    blurb: 'Railways make overland freight as cheap as water. Junctions and coalfields rise; towns the rails bypass stagnate.',
    land: 0.5, slopeK: 20, forest: 1.2, marsh: 1.4, road: [0.7, 0.45, 0.32], rail: 0.045,
    riverDown: 0.14, riverUp: 0.2, lake: 0.14, seaCoastal: 0.07, seaOpen: 0.07, transfer: 3.5, cross: 0.4, locks: true,
    farmDensity: 30, urbanShare: 0.42, overseas: 1.0, marketRangeKm: 25,
    weights: { market: 0.14, trade: 0.22, transfer: 0.1, through: 0.05, industry: 0.3, resource: 0.14, admin: 0.05 },
    resourceDemand: { ore: 1.5, coal: 2.0, salt: 0.3, stone: 0.5, timber: 0.6, gold: 0.8 },
  },
  {
    id: 4, name: 'Automobile', startYear: 1400,
    blurb: 'Trucks and highways reach everywhere. Proximity to big markets matters most; metropolises sprawl.',
    land: 0.32, slopeK: 9, forest: 1.05, marsh: 1.2, road: [0.6, 0.3, 0.12], rail: 0.04,
    riverDown: 0.12, riverUp: 0.15, lake: 0.12, seaCoastal: 0.05, seaOpen: 0.05, transfer: 2.5, cross: 0.15, locks: true,
    farmDensity: 30, urbanShare: 0.68, overseas: 1.2, marketRangeKm: 35,
    weights: { market: 0.14, trade: 0.2, transfer: 0.07, through: 0.03, industry: 0.42, resource: 0.06, admin: 0.08 },
    resourceDemand: { ore: 0.8, coal: 0.6, salt: 0.2, stone: 0.4, timber: 0.3, gold: 0.4 },
  },
];

export const END_YEAR = 1600;

export function eraForYear(y: number): EraId {
  let e: EraId = 0;
  for (const d of ERAS) if (y >= d.startYear) e = d.id;
  return e;
}

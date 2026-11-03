// The look: an antique engraved atlas. Parchment paper, sepia ink,
// hand-tinted lowlands, water-lined coasts, red roads, italic lettering.

export const INK = '#3a2a1b';
export const INK_SOFT = 'rgba(58,42,27,0.55)';
export const RIVER_INK = '#3d6a86';
export const WATER_LINE = 'rgba(61,106,134,';
export const ROAD_INK = '#9a3b26';
export const RAIL_INK = '#1f1a16';
export const PAPER = '#f1e6c9';
export const LABEL_HALO = 'rgba(241,230,201,0.85)';

export const FONT_SERIF = '"IM Fell English", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
export const FONT_SC = '"IM Fell English SC", "IM Fell English", Georgia, serif';

export type RGB = [number, number, number];

export const C = {
  paper: [241, 230, 201] as RGB,
  lowland: [222, 222, 178] as RGB, // fertile, faint green
  dry: [238, 220, 176] as RGB,
  upland: [226, 205, 165] as RGB,
  high: [214, 193, 160] as RGB,
  snow: [244, 240, 228] as RGB,
  forest: [206, 213, 170] as RGB,
  marsh: [210, 220, 196] as RGB,
  sea: [205, 219, 210] as RGB,
  deep: [182, 202, 198] as RGB,
  lake: [196, 214, 210] as RGB,
  shadow: [92, 64, 38] as RGB,
};

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

# Progress

## Done
- **M1 Terrain + hydrology**: noise terrain with styles, droplet hydraulic + thermal erosion, priority-flood depression filling, D8 flow, precipitation-weighted accumulation, lakes, navigability, confluences / mouths / falls / heads of navigation / fords / passes, river naming. Antique-atlas Canvas 2D renderer with pan/zoom/pinch.
- **M2 Movement + villages + markets + inspector**: two-layer (land/water) least-cost graph with transfer (break-of-bulk) costs, per-era cost tables, Dijkstra; ten-mile-rule villages that bud onto free farmland; central-place market towns; "Why here?" inspector with founding factors and growth breakdown.
- **M3 Trade/roads/eras/rank-size**: gravity-model trade between the biggest places plus overseas trade, traffic -> roads -> cheaper routes (path dependence), port / crossing / pass town founding, canals, railways with junctions, five eras, rank-size and population-over-time charts.

## Next
- M4 polish: brushes (implemented, needs testing), overlays, timeline polish.
- M5 guided scenarios.
- M6 Earth Mode (AWS Terrarium tiles + Natural Earth at build time).
- M7 onboarding, perf, mobile, README.

## Known issues
- Full 1600-year run takes ~12 s in the worker on a laptop-class CPU.

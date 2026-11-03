# Progress

## Done
- **M1 Terrain + hydrology** — noise terrain with five styles, droplet hydraulic + thermal erosion, climate with orographic rain / rain shadow, priority-flood filling, D8 flow, discharge, lakes, navigability, confluences / mouths / falls / heads of navigation / fords / passes, named rivers. Antique-atlas Canvas 2D renderer with pan, wheel and pinch zoom.
- **M2 Movement, villages, markets, inspector** — two-layer land/water cost graph with break-of-bulk transfers, per-era cost tables, Dijkstra; ten-mile-rule villages; central-place market towns; “Why here?” inspector.
- **M3 Trade, roads, eras, Zipf** — gravity trade (incl. the world beyond the map), traffic → roads → cheaper routes, ports / crossing / pass / mining / junction towns, canals, railways, five eras, rank-size and population-over-time charts.
- **M4 Tools & polish** — terrain brushes that keep history, overlays (sites, elevation, fertility, movement cost, village fields, market areas, trade flows, roads, founding era), chronicle and ticker, mobile layout.
- **M5 Lessons** — six guided scenarios with live goal checks and real-world epilogues.
- **M6 Earth Mode** — ten regions preprocessed from AWS Terrain Tiles + Natural Earth; scoring with a random-placement baseline; researched notes for ~150 cities.
- **M7 Polish** — onboarding, help, README with screenshots, unit tests (19), GitHub Pages workflow, static-layer render cache (pan is a single blit; zoom re-renders after the wheel settles).

## Next / ideas
- Speed: a full 1,600-year run takes ~10–17 s in the worker. A bucket-queue Dijkstra or coarser trade graph would help.
- Earth Mode skill is weak for the US interior, the Great Lakes and the Andes (see README table). Ideas: exogenous colonisation order (settlement spreading inland from the coast), a real precipitation grid, an explicit “railway era centrality” term.
- “Explore anywhere”: fetch Terrarium tiles at runtime for a user-chosen box (the loader already handles the format; needs a land mask from elevation).
- Brushes in Earth Mode (currently off on purpose).
- Save/share a world as a URL (seed + brush log).

## Known issues
- A static-layer re-render takes ~20–40 ms (once per zoom step or snapshot); while history plays, snapshots arrive ~5×/s.
- On phones the guide panel covers most of the map; close it (×) to explore.
- The Yangtze and Rhine deltas split into many mapped channels, so the model’s main stem carries less water than reality.
- Settlement names are generated in Earth Mode too (they are the model’s predictions, not the real towns).

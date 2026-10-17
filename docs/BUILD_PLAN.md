# 4-Hour Hackathon Build Plan: Local Business Gap Analyzer

As of 2026-10-17

## The 4-hour build

Three data sources, one deterministic score, one LLM call. Everything else is cut.

**Drop:** H3, GDELT, Reddit, LODES, Overture, isochrones, lookalike benchmarks, "validate my idea" mode, and any caching beyond an in-memory Map. Don't tune the globe-to-flat transition either; MapLibre's globe projection gives it to you for free.

**Keep:**

1. **Map.** MapLibre GL JS with `projection: globe`. Click anywhere, drop a pin, draw an 800 m circle. That circle is the selection. No hex, no polygon tools.
2. **Supply: Overpass.** One query for all `shop`, `amenity`, `leisure` nodes and ways within 800 m. Map OSM tags to about 20 categories with a hardcoded dictionary. Count per category. Free, no key.
3. **Demand: Census.** Two calls. Census Geocoder (`geographies/coordinates`) returns the tract FIPS; ACS 5-year for that tract returns population, median income, median age, % renters, % households with kids, % no vehicle. Tract level is enough; skip block groups.
4. **Quality and closures: Google Places Nearby Search (New).** One call, 20 results, fields: name, types, rating, userRatingCount, businessStatus. Then Place Details with reviews for the top 8 by rating count. About 9 Places calls per analysis.
5. **Gap score (pure code, ~20 lines).** Per category, `count_per_1k = count / (pop / 1000)`. Compare to a hardcoded benchmark table of typical US urban densities. `gap = benchmark - local`, multiplied by a demand-fit weight from demographics (renters up → laundromat, kids up → daycare, income up → specialty grocery). Sort.
6. **One Claude call** with the gap table, demographics, and review snippets. Ask for JSON: top 3 concepts, each with rationale, evidence, and risk. Render as cards; clicking a card highlights the competing pins on the map.

## Time plan

The front end never waits on data: a mocked `/api/analyze` response ships in the first 45 minutes.

| Clock | Block | What gets done |
| --- | --- | --- |
| 0:00–0:45 | Scaffold | Next.js project, MapLibre globe, click-to-pin, 800 m circle. `POST /api/analyze {lat, lng}` returns hardcoded JSON so the front end can build against it immediately. |
| 0:45–2:00 | Data core | Overpass adapter + category mapping, Census adapter, gap score. Test on two real neighborhoods and sanity-check the numbers by hand. |
| 2:00–2:45 | Places | Google Places adapter + review pull. Wire all three sources into `/api/analyze`. |
| 2:45–3:15 | LLM + UI | Claude call with a strict JSON schema. Cards UI with click-to-highlight pins. |
| 3:15–3:45 | Demo prep | Run the three demo spots, fix whatever looks wrong, pre-warm the in-memory cache so the demo is instant. |
| 3:45–4:00 | Freeze | Don't touch the code. Rehearse. |

## Three rules for the next four hours

1. Mock the API response first so the front end is never blocked on data.
2. Pick the three demo neighborhoods now and only test on those.
3. If any source breaks, delete it rather than debug it. Overpass + Census + Claude alone is still a demo.

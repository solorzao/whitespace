# Data ingestion plan

As of 2026-10-17. Owner: Kevin. This expands the Kevin rows of [PROJECT_PLAN.md](../PROJECT_PLAN.md).

## Goal

Given any US point, return the businesses, demographics and `SourceDoc` records for the 800 m circle around it, in the shared contract format. The same code serves two uses:

- **Live:** Oliver's `/api/analyze` calls `collectArea(lat, lng)` for wherever the user drops a pin.
- **Saved:** a script runs `collectArea` on the two [demo areas](../PROJECT_PLAN.md#demonstration-data) and commits the results as JSON. A pin within 300 m of a demo center snaps to that center and returns the saved file, so the stage demo never depends on Overpass or Places. Add `?live=1` to force a live run.

## Decisions

| Decision | Choice |
| --- | --- |
| Radius | 800 m for everything except Wikipedia, which uses 1.5 km. |
| Demo areas | Santa Monica (34.0195, -118.4912) and Lower Manhattan (40.7075, -74.0113). Tokyo moves to after the hackathon. |
| Category counts | From OpenStreetMap only. Places is capped at 20 results, so it can't be used for counting. |
| Census population | Every tract whose center point is in the circle, added up. One tract is much smaller than the circle, so a single tract would make every category look overserved. |
| Wikipedia | Kept, but built last and the first thing cut. It feeds `/api/ask` only. |
| Shared types | Kevin writes `src/lib/types.ts` from the contract in the first 15 minutes, and Oliver imports it. |
| Testing | A check script, not a test framework. |
| Failures | If Overpass and its mirror both fail, return a clear "business data unavailable, try again" error. A Census, Places or Wikipedia failure only removes that part of the result. |

## Categories

Post this list to the team in the first 15 minutes. The benchmark table and the map colors depend on it.

| ID | Category | Examples |
| --- | --- | --- |
| `grocery` | Grocery | Supermarkets |
| `specialty_food` | Specialty food | Butchers, delis, health food, cheese |
| `convenience` | Convenience | Convenience stores, corner shops |
| `bakery` | Bakery | Bakeries, pastry shops |
| `restaurant` | Restaurant | Sit-down restaurants |
| `fast_food` | Fast food | Fast food, takeout |
| `cafe` | Café | Coffee shops, tea shops |
| `bar` | Bar | Bars, pubs, nightclubs |
| `liquor` | Liquor | Liquor stores, wine shops |
| `pharmacy` | Pharmacy | Pharmacies, drugstores |
| `medical` | Medical | Doctors, dentists, clinics |
| `laundry` | Laundry | Laundromats, dry cleaners |
| `hair_beauty` | Hair and beauty | Hair salons, barbers, nail salons |
| `fitness` | Fitness | Gyms, yoga and fitness studios |
| `childcare` | Childcare | Daycare, preschools |
| `pet` | Pet | Pet stores, groomers, vets |
| `clothing` | Clothing | Clothing and shoe stores |
| `hardware` | Hardware | Hardware, DIY, garden centers |
| `bank` | Bank | Banks, credit unions |
| `books` | Books | Bookstores |

Anything that doesn't map to one of these, such as parking, benches or places of worship, is dropped.

## Files

```
src/lib/types.ts         SourceDoc and the analyze types, from the shared contract
src/lib/ingest/
  categories.ts          The 20 categories, the OSM tag map and the Google type map
  geo.ts                 Distance between points, point-in-circle check
  http.ts                fetch with a timeout and one retry
  demo-areas.ts          The two demo centers, and the 300 m snap check
  overpass.ts            OpenStreetMap businesses and category counts
  census.ts              Tracts in the circle and their ACS demographics
  places.ts              Google Places businesses and reviews
  wikipedia.ts           Geotagged Wikipedia articles
  index.ts               collectArea(): snap or run all adapters, then merge
scripts/
  check-area.ts          Runs collectArea for a demo area or a lat,lng and prints a summary
  ingest-demo.ts         Runs collectArea live on both demo areas and writes data/demo/<slug>.json
data/demo/               The saved demo results, committed to the repo
```

The adapters use relative imports and plain `fetch` only, so they run both in Next.js route handlers and in the scripts. The scripts run with `npx tsx --env-file=.env.local scripts/<name>.ts`.

## Adapters

Every adapter takes `(lat, lng, radiusM)` and returns its `SourceDoc` records plus any structured data. A failing adapter returns an error instead of throwing.

### OpenStreetMap (Overpass)

- One query for named `shop`, `amenity` and `leisure` nodes, ways and relations within 800 m, with `out center tags` so ways have a point.
- Use `overpass-api.de`, and try a mirror once if it fails. Set a 25-second timeout.
- Output: one business per mapped element, one `SourceDoc` each (`osm:node/123`, linking to openstreetmap.org), and a count per category.

### US Census (ACS 2020–2024 5-year)

- Find the tracts in the circle with a TIGERweb query (point plus distance). Keep the tracts whose center point is inside the circle. If none are, use the tract that contains the point.
- Get the variables for those tracts, with one request per county: population (`B01003_001E`), median household income (`B19013_001E`), median age (`B01002_001E`), renters (`B25003`), households with children (`B11005`), households with no vehicle (`B08201`) and median rent (`B25064_001E`).
- The Census API requires a key (`CENSUS_API_KEY`). It also has to be set on Vercel.
- Output: one `SourceDoc` per tract (`census:<11-digit FIPS>`, linking to data.census.gov), and one combined demographics object for the circle with `tractFips` as a list. Counts and percentages are calculated from the summed totals. Medians are population-weighted averages, labeled as estimates.
- Outside the US, return "no data" rather than an error.

### Google Places (New)

- Nearby Search: 20 results within 800 m, with `includedTypes` set to the Google types that map to our categories, `rankPreference: POPULARITY` and `languageCode: en`. Field mask: `id, displayName, types, primaryType, location, rating, userRatingCount, businessStatus, googleMapsUri`.
- Place Details with `reviews` for the top 8 by rating count. That's about 9 billed calls per live area.
- Output: businesses with ratings and open or closed status, `places:<id>` records, and `review:<id>:<n>` records.
- When an OSM business and a Places business have matching names and are less than 50 m apart, merge them into one business, so the map doesn't show duplicate dots. Counts still come from OSM.

### Wikipedia (GeoSearch)

- `list=geosearch` for up to 30 articles within 1.5 km, then their plain-text introductions in batches of 20.
- Send a descriptive `User-Agent`, as Wikimedia's API policy requires.
- Output: `wikipedia:<pageid>` records that link to the article.

### collectArea

- If the point is within 300 m of a demo center and `live` isn't set, return that area's saved file.
- Otherwise run all adapters in parallel with `Promise.allSettled`, each with its own timeout, and merge the results.
- Returns `{ center, radiusM, businesses, demographics, categoryCounts, docs, errors }`, which Oliver uses to build the `/api/analyze` response.

### Category reviews

Added after the first four PRs. The general reviews come from the 8 most-rated places, which are mostly restaurants and bars, so they say little about a laundromat or a daycare. Category reviews are fetched for the category being evaluated.

- `getCategoryReviews(lat, lng, category)` in `category-reviews.ts`: a Nearby Search for places whose primary Google type is in that category (`includedPrimaryTypes`), ranked by popularity, within 800 m. Searching by primary type keeps furniture stores that merely list `home_improvement_store` out of hardware, for example. If fewer than 3 competitors are found, a second search ranked by distance looks out to 2 km. The nearest competitors and their distance are evidence for a gap, too.
- Reviews for the 5 most-rated competitors, up to 25 reviews in all. That's 6–7 billed calls per category.
- Output: the competitors, each with its distance and whether it's inside the circle, plus `places:` and `review:` docs in the usual format. The place docs say how far each competitor is from the pin.
- Saved demo areas: `ingest-demo.ts` also saves category reviews for all 20 categories, about 130 calls per area, once. `getCategoryReviews` uses the saved data near a demo center, the same way `collectArea` does.
- For `/api/analyze` (Oliver): after the gap score, call `getCategoryReviews` for the top 3 gap categories and pass the results to `addCategoryReviews(area, results)` before `generateConcepts`. That helper puts up to 8 reviews per category ahead of the general reviews, so they fit in the concepts prompt. It also adds in-circle competitors that aren't on the map yet.
- For `/api/ask` (Oliver): `CATEGORY_REVIEWS_TOOL` is a tool definition for Claude, and `runCategoryReviewsTool(input, center)` runs it. Claude calls it when a question is about a kind of business the documents don't cover well.
- Contract changes:
  - `AskRequest` gains `center`, so the tool knows where to search.
  - `AskResponse` gains `docs`, the newly fetched documents. The client adds them to the docs it sends with the next question.

## Pull requests

Post in the team chat when each PR is up.

| PR | Contents | Done when |
| --- | --- | --- |
| 1 | `types.ts`, `categories.ts`, `geo.ts`, `http.ts`, `demo-areas.ts` | Oliver and Hadi can import the types and category list. |
| 2 | Overpass, Census, `collectArea`, `check-area.ts` | The counts and demographics for both demo areas look right when checked by hand, and Oliver can call `collectArea` from `/api/analyze`. |
| 3 | Places, reviews, merging duplicate businesses | Each demo area has ratings and reviews. |
| 4 | Wikipedia, `ingest-demo.ts`, `data/demo/*.json` | Both saved demo files are committed, and a pin near a demo center loads instantly. |
| 5 | Category reviews, `addCategoryReviews`, the ask tool, saved category reviews | Both demo areas have reviews for every category, and Oliver can call them from `/api/analyze` and `/api/ask`. |

## Timing

| Clock | Work |
| --- | --- |
| 0:00–0:15 | Post the category list. Write `types.ts`. Open PR 1. |
| 0:15–1:30 | Overpass adapter, then Census adapter. |
| 1:30–2:00 | `collectArea` and `check-area.ts`. Check both demo areas by hand. Open PR 2. |
| 2:00–2:45 | Places adapter and reviews. Open PR 3. |
| 2:45–3:15 | Wikipedia adapter and `ingest-demo.ts`. Open PR 4. |

## Risks

- **Overpass rate limits.** The saved demo files cover the stage demo, and the mirror covers live pins.
- **Places cost.** About 9 billed calls per live area. Saved demo areas cost nothing.
- **Places terms.** Google limits how long Places content can be stored. Saved demo files are fine for a hackathon, but refresh them rather than keeping them long term.
- **Tract center points.** Using tracts whose center point is in the circle is an approximation. A large tract at the edge can count fully or not at all.

# Data ingestion plan

As of 2026-10-17. Owner: Kevin. This expands the Kevin rows of [PROJECT_PLAN.md](../PROJECT_PLAN.md).

## Goal

Given any US point, return the businesses, demographics and `SourceDoc` records for the 800 m circle around it, in the shared contract format. The same code serves two uses:

- **Live:** Oliver's `/api/analyze` calls `collectArea(lat, lng)` for wherever the user drops a pin.
- **Saved:** a script runs `collectArea` on the two [demo areas](../PROJECT_PLAN.md#demonstration-data) and commits the results as JSON. A pin within 300 m of a demo center snaps to that center and returns the saved file, so the stage demo never depends on Overpass or Places. Add `?live=1` to force a live run.

## Decisions

| Decision | Choice |
| --- | --- |
| Radius | 800 m for everything except Wikipedia, which uses 1.5 km, and the competitor search, which uses 2 km. |
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
  competitors.ts         Places competitors and their reviews within 2 km, for one category
  index.ts               collectArea(): snap or run all adapters, then merge
scripts/
  check-area.ts          Runs collectArea for a demo area or a lat,lng and prints a summary
  ingest-demo.ts         Runs collectArea and collectCompetitors live on both demo areas and writes data/demo/
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

- Nearby Search: 20 results within 800 m, with `includedTypes` set to the Google types that map to our categories, `rankPreference: POPULARITY` and `languageCode: en`. Field mask: `id, displayName, types, primaryType, location, rating, userRatingCount, businessStatus, googleMapsUri, priceLevel, priceRange, regularOpeningHours`.
- Place Details with `reviews, delivery, dineIn, takeout, reservable` for the top 8 by rating count. That's about 9 billed calls per live area. Rating is already in the Nearby Search mask and reviews already in Place Details, so the added fields keep each call in its current billing tier: Nearby Search Enterprise and Place Details Enterprise + Atmosphere. Confirmed on Google's docs on 2026-10-17.
- Output: businesses with ratings, review counts, open or closed status, price level, hours and service options (the `Business` fields in the [analysis plan](ANALYSIS_PLAN.md#contract-changes)), plus `places:<id>` records and `review:<id>:<n>` records.
- When an OSM business and a Places business have matching names and are less than 50 m apart, merge them into one business, so the map doesn't show duplicate dots. Counts still come from OSM.

### Wikipedia (GeoSearch)

- `list=geosearch` for up to 30 articles within 1.5 km, then their plain-text introductions in batches of 20.
- Send a descriptive `User-Agent`, as Wikimedia's API policy requires.
- Output: `wikipedia:<pageid>` records that link to the article.

### Competitors (Google Places, 2 km)

- `collectCompetitors(category, lat, lng, radiusM)`, for one concept category. `/api/analyze` calls it for up to 5 categories after scoring the gaps, so it isn't part of `collectArea`.
- One Nearby Search within 2 km: `includedPrimaryTypes` set to that category's Google types, 20 results, `rankPreference: POPULARITY`, the circle search's fields, plus `reviews, delivery, dineIn, takeout, reservable`. That's one Nearby Search Enterprise + Atmosphere call, about $0.04.
- Primary types, not `includedTypes`: `includedTypes` also matches places that only list the type. In Santa Monica it filled hardware's 20 results with furniture stores tagged `home_improvement_store`.
- Nearby Search accepts `places.reviews`, so no Place Details calls are needed. Each competitor comes with up to 5 reviews, about 60–100 per category.
- Output: an `AdapterResult` with the businesses, plus their `places:` records (which give the distance from the pin) and their `review:` records. It never throws. `competitorsNotOnMap(businesses, competitors)` keeps the ones that aren't already in the circle's businesses, for `AnalyzeResponse.competitors`.
- Saved data: `ingest-demo.ts` saves the competitors for all 20 categories in `data/demo/<slug>-competitors.json`, 20 calls per area. Near a demo center, `collectCompetitors` returns the saved data, so the analysis can be built and tested on the demo areas without live calls, before the full `/api/analyze` response is saved.

### Price level

Google's `priceLevel` and `priceRange` are the only business price data we collect. OSM and Census have none. Both come with both Places searches, the circle's and the 2 km competitors', at no extra cost: like `rating`, they're on the Nearby Search Enterprise SKU.

- `priceLevel` maps to `Business.priceLevel`: 0 = free, up to 4 = very expensive.
- `priceRange` maps to `Business.priceRange: { min, max }`, in US dollars per person. `max` is `null` for an open-ended range such as "$100+".
- Each place doc gives both in words, such as "Price level: inexpensive ($). Price per person: $10–20."

**Coverage** in the saved 2 km competitors, both demo areas together:

| Category | Priced | At level 1 ($) |
| --- | --- | --- |
| Restaurant | 35 of 37 | 8 of 35 |
| Café | 36 of 40 | 31 of 36 |
| Bakery | 30 of 37 | 29 of 30 |
| Bar | 29 of 34 | 4 of 29 |
| Specialty food | 21 of 27 | 18 of 21 |
| Fast food | 21 of 36 | 20 of 21 |
| Hair and beauty | 21 of 38 | 0 of 21 |
| The other 13 categories | 0 | — |

Google prices only food and drink, and hair and beauty. Grocery, convenience, liquor, pharmacy, medical, laundry, fitness, childcare, pet, clothing, hardware, bank and books never have a price level. In the circle itself, 27 of the 38 rated businesses have one.

**What this means for the analysis:**
- **A missing price level means unknown, not "none".**
- **Level 1 is only informative for restaurants and bars.**

The [analysis plan's `mismatched` checks](ANALYSIS_PLAN.md#gap-type-rules) and success profile apply both points, with a code sketch.

**Using it** (all on `Business`, for the circle's businesses and `collectCompetitors` results alike):

| Field | Type | Set for | Example |
| --- | --- | --- | --- |
| `priceLevel` | `0`–`4` | Priced Places businesses | `1` = inexpensive ($) |
| `priceRange` | `{ min, max }` in USD per person, `max` `null` if open-ended | The same businesses as `priceLevel` | `{ min: 10, max: 20 }` |
| `closesAt` | Hours after midnight, latest Monday–Friday close | 95% of competitors | `21.5` = 9:30 pm, `25` = 1 am, `24` = open all day |
| `services` | `{ delivery?, dineIn?, takeout?, reservable? }` | About half of competitors, mostly food | `{ delivery: true, dineIn: true }` |

Each place doc already states these in words, so Claude can cite them by `places:` id.

**Filling the gaps:**

- **`priceRange`** gives the dollar amounts, such as `$10–20` for a café or `$40–60` for a salon. It covers the same places as `priceLevel`, so it adds no coverage. It does give cards real numbers ("the cheapest café nearby is $10–20 a person"), and it splits businesses that share a level: two `$$` salons can be $20–60 and $40–80.
- **Reviews** are the only price signal for the 13 unpriced categories. The analysis plan's review tagging already has a `price` topic, so a laundromat's card can say "price complained about in 5 of 9 reviews" with no price level at all.
- **Census** median household income and median rent are already in `demographics`. They're the demand side of price: a gap for a budget option means more where incomes are lower.

### collectArea

- If the point is within 300 m of a demo center and `live` isn't set, return that area's saved file.
- Otherwise run all adapters in parallel with `Promise.allSettled`, each with its own timeout, and merge the results.
- Returns `{ center, radiusM, businesses, demographics, categoryCounts, docs, errors }`, which Oliver uses to build the `/api/analyze` response.

## Pull requests

Post in the team chat when each PR is up.

| PR | Contents | Done when |
| --- | --- | --- |
| 1 | `types.ts`, `categories.ts`, `geo.ts`, `http.ts`, `demo-areas.ts` | Oliver and Hadi can import the types and category list. |
| 2 | Overpass, Census, `collectArea`, `check-area.ts` | The counts and demographics for both demo areas look right when checked by hand, and Oliver can call `collectArea` from `/api/analyze`. |
| 3 | Places, reviews, merging duplicate businesses | Each demo area has ratings and reviews. |
| 4 | Wikipedia, `ingest-demo.ts`, `data/demo/*.json` | Both saved demo files are committed, and a pin near a demo center loads instantly. |
| 5 | Extra Places fields, the competitor search and `PLACES_LIVE` | Businesses have price level, hours and service options, `collectCompetitors` returns 2 km businesses with reviews, and the deployed app makes no billed Places calls. |

## Timing

| Clock | Work |
| --- | --- |
| 0:00–0:15 | Post the category list. Write `types.ts`. Open PR 1. |
| 0:15–1:30 | Overpass adapter, then Census adapter. |
| 1:30–2:00 | `collectArea` and `check-area.ts`. Check both demo areas by hand. Open PR 2. |
| 2:00–2:45 | Places adapter and reviews. Open PR 3. |
| 2:45–3:15 | Wikipedia adapter and `ingest-demo.ts`. Open PR 4. |
| Next | Extra Places fields and the competitor search. Open PR 5. |

## Risks

- **Overpass rate limits.** The saved demo files cover the stage demo, and the mirror covers live pins.
- **Places cost.** About 9 billed calls per live area, plus up to 5 competitor searches. Saved demo areas cost nothing. Live Places calls are off unless `PLACES_LIVE=1`, which stays unset on Vercel, so the deployed app is never billed. Away from the demo areas it skips ratings, reviews and competitors, and `errors` says why. `ingest-demo.ts` turns live calls on for itself.
- **Sparse Google fields.** Price level exists only for food and drink, and hair and beauty: see [Price level](#price-level). Service options are set for about half of competitors, and almost none outside food. Rules built on these fields have to treat a missing value as unknown.
- **Places terms.** Google limits how long Places content can be stored. Saved demo files are fine for a hackathon, but refresh them rather than keeping them long term.
- **Tract center points.** Using tracts whose center point is in the circle is an approximation. A large tract at the edge can count fully or not at all.

# Whitespace plan

As of 2026-10-17. This plan combines the earlier project plan (Hadi) and 4-hour build plan (Kevin) and replaces both.

## North star

Click a US neighborhood and Whitespace shows which businesses it is missing and the evidence for each gap, then answers follow-up questions with links to its sources.

## What the user does

1. Opens the globe and zooms to a neighborhood. The globe is the opening shot; the analysis happens at street level.
2. Clicks to drop a pin. An 800 m circle shows the area being analyzed.
3. Sees the existing businesses as small dots colored by category. Clicking a dot shows its details and a link to its source.
4. Reads three concept cards, one for each top gap. Each shows the kind of gap, the numbers behind it, a review quote, what the best competitors nearby do, and a risk. Clicking a card highlights the competing businesses on the map.
5. Asks follow-up questions in a chat panel. Each answer cites the data it used, with links.

## Scope

**Out of the MVP:**

- Pins that only mark where data was collected. The user drops the pin.
- Box selection. The circle is the selection.
- YouTube, social media, Zillow and LinkedIn. Wikipedia is in, but only as context for follow-up answers.
- Competitors' POS or ERP systems, a trained sentiment model, review embeddings and a market-size estimate. The [analysis plan](docs/ANALYSIS_PLAN.md) says why.
- H3, GDELT, Reddit, LODES, Overture, isochrones, lookalike benchmarks and a "validate my idea" mode.
- A vector database. One area's data fits in one Claude request.
- A city-wide heatmap that answers "where should I open X?". Pitch it as the next step.

**Constraint:** Census data covers only the US. A click outside the US shows a message instead of an analysis.

## Data sources

| Source | What it gives | Calls per analysis | Key |
| --- | --- | --- | --- |
| OpenStreetMap (Overpass) | All `shop`, `amenity` and `leisure` nodes and ways within 800 m, mapped to about 20 categories with a hardcoded dictionary. | 1 | None |
| TIGERweb and ACS 2020–2024 5-year | The tracts whose center point is inside the circle, then their population, median income, median age, % renters, % households with kids and % households with no vehicle, combined for the circle. | 3 | Census API key |
| Google Places (New) | Nearby Search, limited to our categories and ranked by popularity: 20 results with name, types, rating, userRatingCount, businessStatus, price level and hours. Place Details with reviews and service options for the top 8 by rating count. For each concept category, a second Nearby Search within 2 km with reviews, for the success profile. | About 9, plus up to 5 within 2 km | Google Cloud key with billing on |
| Wikipedia (GeoSearch) | Up to 30 geotagged articles within 1.5 km, for follow-up answers only. Built last and cut first. | 2 | None |

If a source breaks, drop it. Overpass, Census and Claude alone are still a demo.

## How it works

1. **Gap score** (pure code). For each category, `count_per_1k = count / (pop / 1000)`. Compare it to a benchmark table: `score = max(0, 1 - local / benchmark) * demandFit`. Demand fit comes from the demographics (more renters → laundromat, more kids → daycare, higher income → specialty grocery). Skip categories the circle would expect fewer than 1 of, then sort.
2. **Concept categories** (pure code). Pick 3 categories and label each gap unserved (too few businesses), poorly served (low ratings within 2 km) or mismatched (missing an hour, price point or service).
3. **Success profile.** For each of the 3, Claude tags the reviews of up to 20 competitors within 2 km by topic, and code compares the top-rated third with the bottom third.
4. **Analysis.** One Claude call with the gap table, demographics, profiles and reviews. It returns JSON with a strict schema: each concept's title, rationale, evidence, quote and risk, plus a "known for" and "complaints" line for each business with reviews. Evidence is a list of `SourceDoc` IDs, so each card can link to and highlight its sources. The server checks every ID, and that each quote appears word for word in its review.
5. **Follow-up answers (retrieval).** `/api/ask` builds the context from the area's documents: the demographics and gap table always, the businesses as a compact table, and the reviews that best match the question. Claude answers only from those documents and cites them by ID, and the server turns the IDs into links. If the documents don't answer the question, the answer says so.

The API keeps no state between calls. `/api/analyze` returns the area's documents, and the front end sends them back with each question. Serverless functions don't share memory, so an in-memory cache can't be relied on to connect the two calls.

The [analysis plan](docs/ANALYSIS_PLAN.md) has the details: the gap type rules, demand fit, the success profile, the Claude calls and the checks.

## Shared contract

Agree on this in the first 15 minutes. Kevin also publishes the list of category names then, because the benchmark table and the map colors both depend on it.

```ts
// One piece of evidence. Every source adapter returns these.
type SourceDoc = {
  id: string;        // "osm:node/123", "census:06075010200", "places:ChIJ...", "review:ChIJ...:0", "wikipedia:123"
  source: "osm" | "census" | "places" | "review" | "wikipedia";
  url: string;       // link shown as the citation
  title: string;
  text: string;      // what Claude reads
  lat?: number;
  lng?: number;
  category?: string; // one of the ~20 categories
};
```

```
POST /api/analyze { lat, lng }
→ {
    center: { lat, lng },
    radiusM: 800,
    demographics: { tractFips: [string], population, medianIncome, medianAge, pctRenters, pctWithKids, pctNoVehicle },
    businesses: [{ id, name, category, lat, lng, rating?, status?, url }],
    gaps: [{ category, localPer1k, benchmarkPer1k, score }],
    concepts: [{ title, category, rationale, evidence: [docId], risk }],
    docs: [SourceDoc]
  }

POST /api/ask { question, docs, history? }
→ { answer, citations: [{ id, title, url }] }
```

`businesses[].id` is a `SourceDoc` ID, so cards and citations can highlight the matching dots.

The analysis plan proposes [new fields](docs/ANALYSIS_PLAN.md#contract-changes) for gaps, concepts, businesses and the success profile. Agree on them as a team before changing `src/lib/types.ts`.

## Demonstration data

Each demo area is the standard 800 m circle. The data for both is collected ahead of time and saved in `data/demo/`. A pin within 300 m of a demo center uses the saved data, so the demo doesn't depend on live sources. See the [ingestion plan](docs/INGESTION_PLAN.md) for details.

| Area | Center (lat, lng) |
| --- | --- |
| Santa Monica (downtown, Wilshire and 4th Street) | 34.0195, -118.4912 |
| New York (Lower Manhattan) | 40.7075, -74.0113 |

Required keys: Google Places API key with billing, Census API key and Anthropic API key. Census and Anthropic also have to be set on Vercel. Google Places is only needed where the saved demo data is generated: live Places calls are billed, so the app makes none unless `PLACES_LIVE=1`. Leave that unset on Vercel, and the deployed app takes ratings, reviews and competitors only from the saved demo areas.

## Team

| Owner | Work | Result |
| --- | --- | --- |
| Kevin | Shared types, category list, Overpass, Census, Places and Wikipedia adapters, the 2 km competitor search, saved demo data. | `SourceDoc` records, category counts and demographics for any US point, and competitors with reviews for one category. |
| Hadi | Next.js app: globe, click-to-pin, circle, business dots, concept cards with their signals and success profile, business popup and chat panel. | The full user interface, built against the mocked API first. |
| Oliver | Mocks, gap score and benchmark table, review tagging and success profile, `/api/analyze` and `/api/ask`, Claude prompts, citation checks, Vercel deployment. | Analysis and answers based on the area's data, deployed. |

## Time plan

The front end never waits on data: mocked `/api/analyze` and `/api/ask` responses ship in the first 45 minutes.

| Clock | Kevin | Hadi | Oliver |
| --- | --- | --- | --- |
| 0:00–0:15 | Everyone: agree on the contract and category list, and confirm the two demo areas. | | |
| 0:15–0:45 | Shared types (`src/lib/types.ts`) and category dictionary. Overpass query. | Next.js scaffold, MapLibre globe (`projection: globe`), click-to-pin, 800 m circle. | Mocked `/api/analyze` and `/api/ask` with fixture data. |
| 0:45–2:00 | Finish Overpass. Census adapter. Check the counts by hand on both demo areas. | Business dots and their details. Concept cards from the mock. | Gap score with demand fit and benchmark table. Analysis prompt with strict JSON and citation checks, tested on fixture data. |
| 2:00–2:45 | Places adapter, reviews and the extra fields. Then the 2 km competitor search. | Chat panel. Clicking a card highlights its competitors. Success profile on the cards. | Review tagging and success profile. `/api/ask` context and citations. Wire the real adapters into `/api/analyze`. |
| 2:45–3:15 | Everyone: replace the mocks with live data end to end. Oliver deploys. | | |
| 3:15–3:45 | Everyone: run both demo areas, fix whatever looks wrong, and save their `/api/analyze` responses as JSON in the repo so the demo is instant even if a source is slow. | | |
| 3:45–4:00 | Freeze. Don't touch the code. Rehearse. | | |

## Rules

1. Mock the API first so the front end is never blocked on data.
2. Test only on the two demo areas.
3. If a source breaks, delete it rather than debug it.
4. Change the shared contract only with the whole team.

## Completion checks

- [ ] Clicking a US location drops a pin and draws an 800 m circle.
- [ ] Existing businesses appear as dots, and clicking one shows its details and source link.
- [ ] The analysis returns three concept cards, each with its gap type, numbers, rationale, evidence, a checked quote and risk.
- [ ] Cards for both demo areas show what the best competitors within 2 km do.
- [ ] Clicking a card highlights its competing businesses.
- [ ] A follow-up question gets an answer that links to its sources.
- [ ] The deployed front end and API work together.
- [ ] Both demo areas load instantly.

## Hosting

Next.js on Vercel for both the front end and the API routes, as one deployment. Azure is not required; add it only if a need comes up. Oliver owns deployment.

## Open decisions

| Decision | Default if nobody objects |
| --- | --- |
| Claude model | `claude-haiku-5-5` for every call (decided 2026-10-17): fast and cheap enough for a live demo. It has no server-side fallback, so the calls send no `fallbacks`. |
| API keys | Who provides the Google Places key and the Anthropic key: TBD. |

## If ahead of schedule

- When a card is selected, show its competitors within 2 km as hollow dots outside the circle, so the gap is visible as empty space. The success profile's competitor search already returns them.

## After the hackathon

- A city-wide gap heatmap that answers "where should I open X?".
- Lookalike benchmarks: compare each area with the most similar neighborhoods instead of a city average.
- Review embeddings, to group reviews into themes at city scale.
- More sources from the original list: Zillow, YouTube and social media.
- Areas outside the US, starting with Tokyo (Shibuya), using Japan's census data from e-Stat.

## Note

Use the [shared scratch pad](https://docs.google.com/document/d/1nVFH77cD7XMB1Ul2_t1LTsmJRh87-5y_1E3sKQqbnEo/edit?usp=sharing) for team notes and ideas.

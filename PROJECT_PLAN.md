# Whitespace plan

As of 2026-10-17. This plan combines the earlier project plan (Hadi) and 4-hour build plan (Kevin) and replaces both.

## North star

Click a US neighborhood and Whitespace shows which businesses it is missing and the evidence for each gap, then answers follow-up questions with links to its sources.

## What the user does

1. Opens the globe and zooms to a neighborhood. The globe is the opening shot; the analysis happens at street level.
2. Clicks to drop a pin. An 800 m circle shows the area being analyzed.
3. Sees the existing businesses as small dots colored by category. Clicking a dot shows its details and a link to its source.
4. Reads three concept cards, one for each top gap, with its rationale, evidence and risk. Clicking a card highlights the competing businesses on the map.
5. Asks follow-up questions in a chat panel. Each answer cites the data it used, with links.

## Scope

**Out of the MVP:**

- Pins that only mark where data was collected. The user drops the pin.
- Box selection. The circle is the selection.
- YouTube, social media, Zillow and LinkedIn. Wikipedia is in, but only as context for follow-up answers.
- H3, GDELT, Reddit, LODES, Overture, isochrones, lookalike benchmarks and a "validate my idea" mode.
- A vector database. One area's data fits in one Claude request.
- A city-wide heatmap that answers "where should I open X?". Pitch it as the next step.

**Constraint:** Census data covers only the US. A click outside the US shows a message instead of an analysis.

## Data sources

| Source | What it gives | Calls per analysis | Key |
| --- | --- | --- | --- |
| OpenStreetMap (Overpass) | All `shop`, `amenity` and `leisure` nodes and ways within 800 m, mapped to about 20 categories with a hardcoded dictionary. | 1 | None |
| TIGERweb and ACS 2020–2024 5-year | The tracts whose center point is inside the circle, then their population, median income, median age, % renters, % households with kids and % households with no vehicle, combined for the circle. | 3 | Census API key |
| Google Places (New) | Nearby Search, limited to our categories and ranked by popularity: 20 results with name, types, rating, userRatingCount and businessStatus. Place Details with reviews for the top 8 by rating count. **Category reviews:** for a category being evaluated, its competitors (out to 2 km when there are fewer than 3 nearby) and reviews of the top 5. | About 9, plus about 6 per category reviewed | Google Cloud key with billing on |
| Wikipedia (GeoSearch) | Up to 30 geotagged articles within 1.5 km, for follow-up answers only. Built last and cut first. | 2 | None |

If a source breaks, drop it. Overpass, Census and Claude alone are still a demo.

## How it works

1. **Gap score** (pure code, about 20 lines). For each category, `count_per_1k = count / (pop / 1000)`. Compare it to a hardcoded table of typical US urban densities: `gap = benchmark - local`. Multiply by a demand-fit weight from the demographics (more renters → laundromat, more kids → daycare, higher income → specialty grocery). Sort.
2. **Analysis.** Fetch category reviews for the top 3 gap categories (`collectCategoryReviews`, then `addCategoryReviews`), so the reviews describe the businesses being proposed rather than the area's most popular restaurants. Then one Claude call with the gap table, demographics and review snippets. It returns JSON with a strict schema: the top 3 concepts, each with its rationale, evidence and risk. Evidence is a list of `SourceDoc` IDs, so each card can link to and highlight its sources.
3. **Follow-up answers (retrieval).** `/api/ask` builds the context from the area's documents: the demographics and gap table always, the businesses as a compact table, and the reviews that best match the question. When the question is about a kind of business the documents don't cover well, Claude calls the `get_category_reviews` tool (`CATEGORY_REVIEWS_TOOL`), and the response returns the new documents so the front end can send them with the next question. Claude answers only from those documents and cites them by ID, and the server turns the IDs into links. If the documents don't answer the question, the answer says so.

The API keeps no state between calls. `/api/analyze` returns the area's documents, and the front end sends them back with each question. Serverless functions don't share memory, so an in-memory cache can't be relied on to connect the two calls.

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

POST /api/ask { question, docs, history?, center? }
→ { answer, citations: [{ id, title, url }], docs? }
```

`businesses[].id` is a `SourceDoc` ID, so cards and citations can highlight the matching dots.

`center` in `/api/ask` is the pin, so the answer can fetch category reviews. Any `docs` in the response were fetched while answering. The front end adds them to the docs it sends with the next question, and drops duplicates by `id`.

## Demonstration data

Each demo area is the standard 800 m circle. The data for both is collected ahead of time and saved in `data/demo/`. A pin within 300 m of a demo center uses the saved data, so the demo doesn't depend on live sources. See the [ingestion plan](docs/INGESTION_PLAN.md) for details.

| Area | Center (lat, lng) |
| --- | --- |
| Santa Monica (downtown, Wilshire and 4th Street) | 34.0195, -118.4912 |
| New York (Lower Manhattan) | 40.7075, -74.0113 |

Required keys: Google Places API key with billing, Census API key and Anthropic API key. All three also have to be set on Vercel.

## Team

| Owner | Work | Result |
| --- | --- | --- |
| Kevin | Shared types, category list, Overpass, Census, Places and Wikipedia adapters, saved demo data. | `SourceDoc` records, category counts and demographics for any US point. |
| Hadi | Next.js app: globe, click-to-pin, circle, business dots, concept cards and chat panel. | The full user interface, built against the mocked API first. |
| Oliver | Mocks, gap score and benchmark table, `/api/analyze` and `/api/ask`, Claude prompts and citations, Vercel deployment. | Analysis and answers based on the area's data, deployed. |

## Time plan

The front end never waits on data: mocked `/api/analyze` and `/api/ask` responses ship in the first 45 minutes.

| Clock | Kevin | Hadi | Oliver |
| --- | --- | --- | --- |
| 0:00–0:15 | Everyone: agree on the contract and category list, and confirm the two demo areas. | | |
| 0:15–0:45 | Shared types (`src/lib/types.ts`) and category dictionary. Overpass query. | Next.js scaffold, MapLibre globe (`projection: globe`), click-to-pin, 800 m circle. | Mocked `/api/analyze` and `/api/ask` with fixture data. |
| 0:45–2:00 | Finish Overpass. Census adapter. Check the counts by hand on both demo areas. | Business dots and their details. Concept cards from the mock. | Gap score and benchmark table. Analysis prompt with strict JSON, tested on fixture data. |
| 2:00–2:45 | Places adapter and reviews. | Chat panel. Clicking a card highlights its competitors. | `/api/ask` context and citations. Wire the real adapters into `/api/analyze`. |
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
- [ ] The analysis returns three concept cards with rationale, evidence and risk.
- [ ] Clicking a card highlights its competing businesses.
- [ ] A follow-up question gets an answer that links to its sources.
- [ ] The deployed front end and API work together.
- [ ] Both demo areas load instantly.

## Hosting

Next.js on Vercel for both the front end and the API routes, as one deployment. Azure is not required; add it only if a need comes up. Oliver owns deployment.

## Open decisions

| Decision | Default if nobody objects |
| --- | --- |
| Claude model | `claude-opus-5-5`. Switch to `claude-sonnet-5-5` if the analysis is too slow for the demo. |
| API keys | Who provides the Google Places key and the Anthropic key: TBD. |

## If ahead of schedule

- When a card is selected, show the nearest competitors outside the circle so the gap is visible as empty space. This needs a second Overpass query for the top 3 categories within 2 km.

## After the hackathon

- A city-wide gap heatmap that answers "where should I open X?".
- More sources from the original list: Zillow, YouTube and social media.
- Areas outside the US, starting with Tokyo (Shibuya), using Japan's census data from e-Stat.

## Note

Use the [shared scratch pad](https://docs.google.com/document/d/1nVFH77cD7XMB1Ul2_t1LTsmJRh87-5y_1E3sKQqbnEo/edit?usp=sharing) for team notes and ideas.

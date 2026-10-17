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
- YouTube, social media, Zillow, LinkedIn and Wikipedia.
- H3, GDELT, Reddit, LODES, Overture, isochrones, lookalike benchmarks and a "validate my idea" mode.
- A vector database. One area's data fits in one Claude request.
- A city-wide heatmap that answers "where should I open X?". Pitch it as the next step.

**Constraint:** Census data covers only the US. A click outside the US shows a message instead of an analysis.

## Data sources

| Source | What it gives | Calls per analysis | Key |
| --- | --- | --- | --- |
| OpenStreetMap (Overpass) | All `shop`, `amenity` and `leisure` nodes and ways within 800 m, mapped to about 20 categories with a hardcoded dictionary. | 1 | None |
| Census Geocoder and ACS 5-year | The tract FIPS from `geographies/coordinates`, then population, median income, median age, % renters, % households with kids and % households with no vehicle. Tract level is enough. | 2 | None |
| Google Places (New) | Nearby Search: 20 results with name, types, rating, userRatingCount and businessStatus. Place Details with reviews for the top 8 by rating count. | About 9 | Google Cloud key with billing on |

If a source breaks, drop it. Overpass, Census and Claude alone are still a demo.

## How it works

1. **Gap score** (pure code, about 20 lines). For each category, `count_per_1k = count / (pop / 1000)`. Compare it to a hardcoded table of typical US urban densities: `gap = benchmark - local`. Multiply by a demand-fit weight from the demographics (more renters → laundromat, more kids → daycare, higher income → specialty grocery). Sort.
2. **Analysis.** One Claude call with the gap table, demographics and review snippets. It returns JSON with a strict schema: the top 3 concepts, each with its rationale, evidence and risk. Evidence is a list of `SourceDoc` IDs, so each card can link to and highlight its sources.
3. **Follow-up answers (retrieval).** `/api/ask` builds the context from the area's documents: the demographics and gap table always, the businesses as a compact table, and the reviews that best match the question. Claude answers only from those documents and cites them by ID, and the server turns the IDs into links. If the documents don't answer the question, the answer says so.

The API keeps no state between calls. `/api/analyze` returns the area's documents, and the front end sends them back with each question. Serverless functions don't share memory, so an in-memory cache can't be relied on to connect the two calls.

## Shared contract

Agree on this in the first 15 minutes. Kevin also publishes the list of category names then, because the benchmark table and the map colors both depend on it.

```ts
// One piece of evidence. Every source adapter returns these.
type SourceDoc = {
  id: string;        // "osm:node/123", "census:06075010200", "places:ChIJ...", "review:ChIJ...:0"
  source: "osm" | "census" | "places" | "review";
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
    demographics: { tractFips, population, medianIncome, medianAge, pctRenters, pctWithKids, pctNoVehicle },
    businesses: [{ id, name, category, lat, lng, rating?, status?, url }],
    gaps: [{ category, localPer1k, benchmarkPer1k, score }],
    concepts: [{ title, category, rationale, evidence: [docId], risk }],
    docs: [SourceDoc]
  }

POST /api/ask { question, docs, history? }
→ { answer, citations: [{ id, title, url }] }
```

`businesses[].id` is a `SourceDoc` ID, so cards and citations can highlight the matching dots.

## Team

| Owner | Work | Result |
| --- | --- | --- |
| Kevin | Overpass adapter and category dictionary, Census adapter, Places adapter with reviews. | `SourceDoc` records, category counts and demographics for any US point. |
| Hadi | Next.js app: globe, click-to-pin, circle, business dots, concept cards and chat panel. | The full user interface, built against the mocked API first. |
| Oliver | Shared types and mocks, gap score and benchmark table, `/api/analyze` and `/api/ask`, Claude prompts and citations. | Analysis and answers based on the area's data. |

## Time plan

The front end never waits on data: mocked `/api/analyze` and `/api/ask` responses ship in the first 45 minutes.

| Clock | Kevin | Hadi | Oliver |
| --- | --- | --- | --- |
| 0:00–0:15 | Everyone: agree on the contract and category list, and pick the three demo neighborhoods. | | |
| 0:15–0:45 | Overpass query and category dictionary. | Next.js scaffold, MapLibre globe (`projection: globe`), click-to-pin, 800 m circle. | Shared types. Mocked `/api/analyze` and `/api/ask` with fixture data. |
| 0:45–2:00 | Finish Overpass. Census adapter. Check the counts by hand on two demo neighborhoods. | Business dots and their details. Concept cards from the mock. | Gap score and benchmark table. Analysis prompt with strict JSON, tested on fixture data. |
| 2:00–2:45 | Places adapter and reviews. | Chat panel. Clicking a card highlights its competitors. | `/api/ask` context and citations. Wire the real adapters into `/api/analyze`. |
| 2:45–3:15 | Everyone: replace the mocks with live data end to end, and deploy. | | |
| 3:15–3:45 | Everyone: run the three demo neighborhoods, fix whatever looks wrong, and save their `/api/analyze` responses as JSON in the repo so the demo is instant even if a source is slow. | | |
| 3:45–4:00 | Freeze. Don't touch the code. Rehearse. | | |

## Rules

1. Mock the API first so the front end is never blocked on data.
2. Test only on the three demo neighborhoods.
3. If a source breaks, delete it rather than debug it.
4. Change the shared contract only with the whole team.

## Completion checks

- [ ] Clicking a US location drops a pin and draws an 800 m circle.
- [ ] Existing businesses appear as dots, and clicking one shows its details and source link.
- [ ] The analysis returns three concept cards with rationale, evidence and risk.
- [ ] Clicking a card highlights its competing businesses.
- [ ] A follow-up question gets an answer that links to its sources.
- [ ] The deployed front end and API work together.
- [ ] The three demo neighborhoods load instantly.

## Hosting

Next.js on Vercel for both the front end and the API routes, as one deployment. Azure is not required; add it only if a need comes up.

## Open decisions

| Decision | Default if nobody objects |
| --- | --- |
| Demo neighborhoods | Pick three in the first 15 minutes. They must be in the US. |
| Claude model | `claude-opus-5-5`. Switch to `claude-sonnet-5-5` if the analysis is too slow for the demo. |
| API keys | Who provides the Google Places key and the Anthropic key: TBD. |
| Deployment owner | TBD. |

## If ahead of schedule

- When a card is selected, show the nearest competitors outside the circle so the gap is visible as empty space. This needs a second Overpass query for the top 3 categories within 2 km.

## After the hackathon

- A city-wide gap heatmap that answers "where should I open X?".
- More sources from the original list: Wikipedia, Zillow, YouTube and social media.

## Note

Use the [shared scratch pad](https://docs.google.com/document/d/1nVFH77cD7XMB1Ul2_t1LTsmJRh87-5y_1E3sKQqbnEo/edit?usp=sharing) for team notes and ideas.

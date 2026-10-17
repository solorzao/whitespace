# Analysis plan

As of 2026-10-17. Owner: Oliver. This expands the Oliver rows of [PROJECT_PLAN.md](../PROJECT_PLAN.md).

## Goal

Each concept card says what kind of gap it is, shows the numbers behind it, quotes a real review, and shows what the best competitors nearby do that the others don't. Clicking a business shows how it is doing and what it is known for.

Code computes every number. Claude pulls structured facts out of reviews and explains the numbers. The server checks every citation and quote before the response goes out. That split answers "isn't this just a ChatGPT wrapper?": without our data Claude has nothing to say, and every number on screen comes from code.

## Decisions

| Decision | Choice |
| --- | --- |
| Numbers | Code computes all of them. Claude only reads them, and the prompt says to use no other numbers. |
| Gap types | `unserved` (too few businesses), `poorly_served` (low ratings) and `mismatched` (missing an hour, price point or service). Code picks the type, and Claude explains it. |
| Gap score | As merged in `gap-score.ts` (#11): `max(0, 1 - local / benchmark) * demandFit`, skipping categories the circle would expect fewer than 1 of. Demand fit nudges a score by up to 25%, from one demographic per category. |
| Success profile | For each of the 3 concept categories: up to 20 competitors within 2 km and their reviews. Code compares the top-rated third with the bottom third. |
| Review topics | A fixed list of 12, so code can count them: price, quality, selection, service, staff, wait, hours, cleanliness, space, atmosphere, location and other. Each tag also carries a short detail, such as "drop-off service". |
| Claude calls | Review tagging: one call per concept category, in parallel, at effort `low`. Concepts: the merged `generateConcepts` call (#9), still at effort `low`. Both use `claude-opus-5-5` with structured output (`output_config.format`) and `fallbacks: "default"`, as `concepts.ts` already does. |
| Cut | The market-size estimate, to make room for the success profile. Wikipedia shipped in #10 before this plan, so it stays as context and gets no more time. Social media, competitors' POS or ERP systems, a trained sentiment model and review embeddings stay out of the MVP. |
| Demo areas | A demo pin returns the saved `/api/analyze` response, which includes the competitors, tags and concepts, so the stage demo makes no live calls. |

## Contract changes

These are proposals. Agree on them as a team before editing `src/lib/types.ts` ([rule 4](../PROJECT_PLAN.md#rules)). Once they're agreed, the mock gets the new fields, so Hadi can build against it.

```ts
export type GapType = "unserved" | "poorly_served" | "mismatched";

// Gap gains the parts of its score and the competitor numbers each card shows.
export type Gap = {
  category: CategoryId;
  count: number; // OSM businesses in the circle
  localPer1k: number;
  benchmarkPer1k: number;
  demandFit: number; // 1 = no adjustment
  demandReasons: string[]; // "78% of households rent"
  ratedCount: number; // Places businesses in the circle with a rating
  avgRating: number | null;
  closedCount: number;
  score: number;
};

export type Quote = { text: string; docId: string };

export type Concept = {
  title: string;
  category: CategoryId;
  gapType: GapType;
  rationale: string;
  evidence: string[]; // SourceDoc ids
  quote: Quote | null;
  risk: string;
};

// What the top-rated competitors within 2 km do that the low-rated ones don't. Every count comes from code.
export type ProfileFinding = {
  kind: "praise" | "complaint" | "attribute";
  label: string; // "drop-off service", "hours", "open after 9 pm"
  top: { count: number; of: number }; // reviews (praise, complaint) or businesses (attribute) in the top-rated third
  low: { count: number; of: number }; // the same for the bottom third
  evidence: string[]; // up to 3 review or places ids
};

export type SuccessProfile = {
  category: CategoryId;
  radiusM: number; // 2000
  businessIds: string[]; // competitors compared, from businesses or competitors
  reviewCount: number;
  findings: ProfileFinding[]; // up to 4, biggest difference first
};

// Business gains what the popup shows. The Places fields are set only for businesses Places returned.
export type Business = {
  // ...the existing fields
  reviewCount?: number;
  priceLevel?: 0 | 1 | 2 | 3 | 4; // free to very expensive
  priceRange?: { min: number; max: number | null }; // US dollars per person; max null = open-ended ("$100+")
  hours?: string[]; // Google's weekday descriptions
  closesAt?: number; // latest weekday closing time in hours: 21.5 = 9:30 pm, 25 = 1 am
  services?: { delivery?: boolean; dineIn?: boolean; takeout?: boolean; reservable?: boolean };
  summary?: { knownFor: string; complaints: string | null; evidence: string[] }; // from Claude, for businesses with reviews
};

// AnalyzeResponse gains:
//   competitors: Business[]   Places businesses within 2 km for the concept categories, not already in businesses
//   profiles: SuccessProfile[]
```

The competitors' `places:` and `review:` records go into `docs`, so citations resolve and follow-up answers can use them.

## How /api/analyze runs

1. **Collect the area.** `collectArea(lat, lng)` returns the circle's businesses, demographics, counts and docs. Kevin owns this step.
2. **Score the gaps.** `scoreGaps(area, benchmark)` (merged) returns a `Gap` for every category. It gains demand fit with its reasons and the circle's competitor numbers.
3. **Pick candidates.** Take the top 3 categories by score, plus up to 2 that the circle's Places data shows as poorly rated.
4. **Collect competitors.** Call `collectCompetitors(category, lat, lng, 2000)` for each candidate in parallel. Kevin owns this step too.
5. **Pick the 3 concepts.** Code gives each candidate a gap type from the 2 km data (rules below) and keeps 3, with one of each type where possible.
6. **Tag reviews.** One Claude call per concept category, in parallel, tags each review with topics.
7. **Build profiles.** `buildProfile()` compares the top-rated third of competitors with the bottom third.
8. **Write concepts.** `generateConcepts` writes each concept's title, rationale, quote and risk. It also gains a "known for" and "complaints" line for each business with reviews.
9. **Verify.** Drop citations to unknown ids and quotes that aren't in their review. Use template text where needed.

If steps 4 to 7 fail, the cards still render, without a success profile. Today `generateConcepts` throws `ConceptsError` after a failed retry, and the route would return a 502. Template cards built from the gap table replace that, so the response always has 3 concepts.

### Gap type rules

| Type | Rule | Example |
| --- | --- | --- |
| `unserved` | A shortfall (`1 - local / benchmark`) of at least 0.5, so the circle has at most half its benchmark, and it would expect at least 1. | "No laundromats; about 2 expected" |
| `poorly_served` | At least 4 rated competitors within 2 km, with an average rating below 4.0. | "4 grocers average 3.4★" |
| `mismatched` | At least 4 competitors within 2 km, and none open after 9 pm, none at price level 1, or none offering delivery. The hours rule applies to food, grocery, pharmacy, laundry and fitness. The delivery rule applies to food and grocery. | "4 cafés, none open after 9 pm" |

A candidate that matches more than one type takes the first in this order, and ties go to the higher score. The thresholds are starting points, to tune on the two demo areas.

### Demand fit

Demand fit is already in `gap-score.ts`. Each category with a signal, such as renters for laundry or households with kids for childcare, has its score nudged by up to 25% according to how the area compares with the US. The new work is returning the fit on each `Gap`, with a reason when the nudge is 10% or more, such as "78% of households rent".

### Success profile

- A category needs at least 6 competitors with reviews. Otherwise its card says there aren't enough reviews nearby.
- Rank competitors by rating, then by review count, and compare the top third with the bottom third.
- For each topic, count praise in the top third's reviews and complaints in the bottom third's. Keep topics mentioned at least 3 times with the biggest difference between the groups.
- Attributes are open after 9 pm, delivery, dine-in, reservations and price level 1 or 2. Keep those where the two groups differ by at least half.
- A finding's label is the most common detail among its tags. Its evidence is up to 3 of those reviews.
- Keep up to 4 findings, biggest difference first. The card shows the first 2, for example: "Top-rated: drop-off service praised in 8 of 12 reviews. Others: hours complained about in 6 of 9."

### Claude calls

**Review tagging** (`tag-reviews.ts`) gets one category's reviews, each with its id. For each review it returns 0 to 3 tags of `{ topic, sentiment: "praise" | "complaint", detail }`, where `detail` is at most 5 words. Code drops tags with an unknown review id or topic.

**Concepts** (`concepts.ts`, merged) already gets the area's data and gap table. It gains the 3 concept categories with their gap types, their profiles, and the reviews the profiles cite, while keeping its current cap of 30 reviews. The prompt says the population counts residents only, so in business districts the risk line should mention workers and visitors. It will return:

```ts
{
  concepts: { category, title, rationale, evidence: string[], quote: { text, docId } | null, risk }[],
  competitors: { businessId, knownFor, complaints: string | null, evidence: string[] }[],
}
```

Code adds each concept's `gapType` from step 5. Reviews and business names are written by the public, so both prompts treat them as data, never as instructions, as the ask route does.

### Verification

`concepts.ts` already drops unknown evidence ids and retries an invalid reply once, with feedback. To add there:

- The quote `docId` and every profile id must be in `docs` too.
- A quote must appear in its review word for word, ignoring case, spacing and curly quotes, and be at most 30 words. Otherwise the quote becomes `null`.
- A concept for a category that isn't one of the 3 is replaced with a template card.
- Numbers in a rationale that don't appear in the inputs are logged, so we can fix the prompt before the demo.
- After a failed retry, use template cards instead of throwing.

### Follow-up answers

The ask route needs no changes. The 2 km competitors and their reviews arrive in `docs`, so follow-up questions can use them.

## Asks for Kevin

- **Extra Places fields.** Add `priceLevel` and `regularOpeningHours` to the circle's Nearby Search. Add `delivery`, `dineIn`, `takeout` and `reservable` to the Place Details call, which already requests reviews. Map them to the new `Business` fields. Rating is already in the Nearby Search field mask and reviews already in Place Details, so each call should stay in its current billing tier. Confirm on the Places pricing page.
- **`collectCompetitors(category, lat, lng, radiusM)`.** One Nearby Search within 2 km, with `includedPrimaryTypes` set to the category's Google types, 20 results ranked by popularity, and all the fields above plus `reviews`. Nearby Search accepts `places.reviews`, so it's one call per category. Primary types keep furniture stores out of hardware, for example. It returns businesses plus their `places:` and `review:` records.
- **A new PR.** PR 4 (Wikipedia and the saved demo areas) has shipped, so the extra fields and the competitor search go in PR 5.

That adds up to 5 billed Places calls per live area. Saved demo areas cost nothing, and live calls are off unless `PLACES_LIVE=1` (see the [ingestion plan](INGESTION_PLAN.md#risks)).

## Asks for Hadi

- **Concept card:** the gap type, the signal rows from the card's `Gap` (supply, demand fit with its reasons, average rating), the quote with its link, and "What the best ones do" with the first 2 findings from its `SuccessProfile`.
- **Business popup:** rating, review count, price level, hours, services, and the "known for" and "complaints" lines with their review links.
- **If ahead of schedule:** when a card is selected, draw its 2 km `competitors` as hollow dots outside the circle. The competitor search already supplies the data.

## Files

```
src/lib/analysis/
  benchmarks.ts      Merged. Per-1k benchmarks by category
  gap-score.ts       Merged. scoreGaps() and demand fit; gains the new Gap fields
  candidates.ts      New. Picks the 3 concept categories and their gap types
  topics.ts          New. The 12 review topics
  tag-reviews.ts     New. The Claude call that tags reviews
  profile.ts         New. buildProfile(): the top-rated third against the bottom third
  concepts.ts        Merged. generateConcepts(); gains gap types, profiles, quotes, competitor lines and template cards
  index.ts           New. analyzeArea(): runs steps 2 to 9 for /api/analyze
scripts/
  check-concepts.ts  Merged. Extend it to print the new card fields
  check-profile.ts   New. Runs tagging and buildProfile on a fixture
```

## Order of work

The gap score (#11), the concepts call (#9) and the ask route (#7) are merged. The rest builds on them.

| Work | Owner | Needs |
| --- | --- | --- |
| Agree the contract, then update `types.ts` and the mock | Everyone | 15 minutes |
| Review tagging and success profile | Oliver (a Claude session, in progress) | A fixture until Kevin's search lands |
| Extra Places fields and `collectCompetitors` | Kevin | The contract |
| New `Gap` fields in `gap-score.ts`, and `candidates.ts` | Oliver | The contract |
| Gap types, quotes, competitor lines and template cards in `concepts.ts` | Oliver | The contract |
| New card fields and the business popup | Hadi | The contract and the mock |
| `analyzeArea`, the analyze route and the saved demo responses | Oliver | All of the above |

The mock gets a few 2 km competitors with made-up reviews, so the cards and the profile can be built before Kevin's search lands.

## Cut order

If we fall behind, cut in this order. The verification checks are never cut.

1. The `mismatched` gap type.
2. Attribute findings in the profile. Keep praise and complaints.
3. The success profile, so cards show only their signals and quote.
4. The "known for" and "complaints" lines in the popup.

## Risks

- **A live pin is slow.** Steps 4, 6 and 8 run one after another, and two of them are Claude calls. `concepts.ts` alone budgets 75 s of the 120 s `maxDuration` it plans for the analyze route, so the competitor search and tagging must fit in what's left, or the budget changes. Measure on the mock early. Demo pins return saved responses.
- **Thin data.** Some categories have fewer than 6 competitors with reviews within 2 km. Their card says so instead of showing a profile.
- **Biased reviews.** Google returns 5 reviews per place, chosen by relevance rather than date. Cards show counts such as "8 of 12 reviews", so nobody mistakes a small sample for a survey.
- **Residential population.** Both demo areas are business districts, so Census counts far fewer people than shop there. The prompt makes the risk line say so.
- **Places terms.** The saved demo responses now hold more Google reviews. That's fine for a hackathon, but refresh them rather than keep them.

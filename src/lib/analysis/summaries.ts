// "Known for" and "complaints" lines for the business popup, counted from review tags. tagReviews labels
// the reviews; this file only counts them per business, and every line carries its counts, so one
// reviewer's opinion never reads as a reputation. Google gives at most 5 reviews per place.

import type { Business, SourceDoc } from "../types";
import { topicLabel } from "./profile";
import type { ReviewTag, Sentiment } from "./tag-reviews";
import { TOPICS, type Topic } from "./topics";

// Proposed for Business.summary in docs/ANALYSIS_PLAN.md ("Contract changes"), plus the business id
// and review count. Local until the team agrees on it.
export type BusinessSummary = {
  businessId: string; // the business's id on the map, or its places: id for a 2 km competitor
  reviewCount: number; // its reviews that were tagged
  knownFor: string | null; // "wash-and-fold service (3 of 5 reviews) and staff (2 of 5)"
  complaints: string | null; // "broken machines (2 of 5 reviews)"
  evidence: string[]; // up to 3 review ids behind the lines
};

// A topic describes a business only when this many of its reviews mention it.
const MIN_MENTIONS = 2;
const MAX_ITEMS = 2;
const MAX_EVIDENCE = 3;

// `reviews` are the reviews that were tagged, including any that got no tags, so the totals are right.
// Businesses without a tagged review, or with nothing mentioned twice, get no summary.
export function summarizeBusinesses(
  businesses: Pick<Business, "id" | "docIds">[],
  reviews: SourceDoc[],
  tags: ReviewTag[],
): BusinessSummary[] {
  // Review "review:<place id>:<n>" belongs to the business whose id or docIds include "places:<place id>".
  const ownerOf = new Map<string, string>();
  for (const b of businesses) {
    for (const id of [b.id, ...(b.docIds ?? [])]) if (id.startsWith("places:") && !ownerOf.has(id)) ownerOf.set(id, b.id);
  }
  const tagsByReview = new Map<string, ReviewTag[]>();
  for (const tag of tags) tagsByReview.set(tag.reviewId, [...(tagsByReview.get(tag.reviewId) ?? []), tag]);

  const reviewsByBusiness = new Map<string, string[]>();
  for (const doc of reviews) {
    const match = doc.source === "review" ? /^review:(.+):\d+$/.exec(doc.id) : null;
    const owner = match ? ownerOf.get(`places:${match[1]}`) : undefined;
    if (!owner) continue;
    const ids = reviewsByBusiness.get(owner) ?? [];
    if (!ids.includes(doc.id)) ids.push(doc.id);
    reviewsByBusiness.set(owner, ids);
  }

  const summaries: BusinessSummary[] = [];
  for (const [businessId, reviewIds] of reviewsByBusiness) {
    const tagsOf = (id: string) => tagsByReview.get(id) ?? [];
    const praise = describe("praise", reviewIds, tagsOf);
    const complaints = describe("complaint", reviewIds, tagsOf);
    if (!praise && !complaints) continue;
    summaries.push({
      businessId,
      reviewCount: reviewIds.length,
      knownFor: praise?.text ?? null,
      complaints: complaints?.text ?? null,
      evidence: [...new Set([...(praise?.reviewIds ?? []), ...(complaints?.reviewIds ?? [])])].slice(0, MAX_EVIDENCE),
    });
  }
  return summaries;
}

// The business's most-mentioned topics for one sentiment: "wash-and-fold service (3 of 5 reviews) and staff (2 of 5)".
function describe(
  sentiment: Sentiment,
  reviewIds: string[],
  tagsOf: (reviewId: string) => ReviewTag[],
): { text: string; reviewIds: string[] } | null {
  const items = TOPICS.map((topic: Topic) => {
    const matching = (id: string) => tagsOf(id).filter((t) => t.topic === topic && t.sentiment === sentiment);
    const ids = reviewIds.filter((id) => matching(id).length > 0);
    return { topic, ids, label: ids.length > 0 ? topicLabel(topic, ids.map(matching)) : topic };
  })
    .filter((item) => item.ids.length >= MIN_MENTIONS)
    .sort((a, b) => b.ids.length - a.ids.length) // stable, so ties keep the TOPICS order
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  const total = reviewIds.length;
  const parts = items.map((item, i) => `${item.label} (${item.ids.length} of ${total}${i === 0 ? " reviews" : ""})`);
  return { text: parts.join(" and "), reviewIds: items.flatMap((item) => item.ids) };
}

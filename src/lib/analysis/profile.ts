// buildProfile(): what the top-rated competitors of one category do that the low-rated ones don't.
// Pure code with no API calls. Every count comes from the competitors, their reviews and the tags.
// Google returns at most 5 reviews per place, so samples are small: findings carry counts such as
// "8 of 12 reviews", never claims of significance.

import type { Business, CategoryId, SourceDoc } from "../types";
import type { ReviewTag, Sentiment } from "./tag-reviews";
import { TOPIC_LABELS, TOPICS, type Topic } from "./topics";

// Proposed in docs/ANALYSIS_PLAN.md ("Contract changes"). Move them to src/lib/types.ts once the team agrees.
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

// The competitor fields buildProfile reads, so collectCompetitors' businesses can be passed as they are.
// Ids are "places:<place id>", and their reviews are "review:<place id>:<n>".
export type ProfileCompetitor = Pick<Business, "id" | "rating" | "reviewCount" | "priceLevel" | "closesAt" | "services">;

export const PROFILE_RADIUS_M = 2000;

// Starting points, to tune on the two demo areas.
const MIN_REVIEWED_COMPETITORS = 6;
const MIN_TOPIC_MENTIONS = 3; // reviews in the group the finding is about
// Below this, praise that is nearly as common among the low-rated isn't something the best ones do.
const MIN_TOPIC_DIFFERENCE = 0.2;
// A detail labels a finding only when at least this share of its reviews mention it; otherwise the topic does.
const MIN_LABEL_SHARE = 0.5;
const MIN_ATTRIBUTE_DIFFERENCE = 0.5;
// Google leaves many of these fields out, so an attribute needs this many businesses with the field in each
// group. That also skips price for the categories Google gives no price level.
const MIN_KNOWN_PER_GROUP = 3;
const MAX_FINDINGS = 4;
const MAX_EVIDENCE = 3;
const EPSILON = 1e-9;

type Group = { competitors: ProfileCompetitor[]; reviewIds: string[] };
type Scored = ProfileFinding & { difference: number; headline: number };

const ATTRIBUTES: { label: string; has: (c: ProfileCompetitor) => boolean | undefined }[] = [
  { label: "open after 9 pm", has: (c) => (c.closesAt === undefined ? undefined : c.closesAt > 21) },
  { label: "delivery", has: (c) => c.services?.delivery },
  { label: "dine-in", has: (c) => c.services?.dineIn },
  { label: "takes reservations", has: (c) => c.services?.reservable },
  {
    label: "inexpensive or moderate prices",
    has: (c) => (c.priceLevel === undefined ? undefined : c.priceLevel === 1 || c.priceLevel === 2),
  },
];

// The reviews buildProfile compares: those of the top and bottom thirds. Tag only these, since the
// middle third's reviews never count. Empty when there are too few reviewed competitors for a profile.
export function profileReviews(competitors: ProfileCompetitor[], reviews: SourceDoc[]): SourceDoc[] {
  const groups = rankGroups(competitors, reviews);
  if (!groups) return [];
  const compared = new Set([...groups.top.reviewIds, ...groups.low.reviewIds]);
  return reviews.filter((doc) => compared.has(doc.id));
}

// Returns null when fewer than 6 competitors have a rating and at least one review.
export function buildProfile(
  category: CategoryId,
  competitors: ProfileCompetitor[],
  reviews: SourceDoc[],
  tags: ReviewTag[],
): SuccessProfile | null {
  const groups = rankGroups(competitors, reviews);
  if (!groups) return null;
  const { top, low } = groups;

  const tagsByReview = new Map<string, ReviewTag[]>();
  for (const tag of tags) tagsByReview.set(tag.reviewId, [...(tagsByReview.get(tag.reviewId) ?? []), tag]);

  const candidates: Scored[] = [
    ...TOPICS.flatMap((topic) => [
      topicFinding("praise", topic, top, low, tagsByReview),
      topicFinding("complaint", topic, top, low, tagsByReview),
    ]),
    ...ATTRIBUTES.map((attribute) => attributeFinding(attribute, top, low)),
  ].filter((f): f is Scored => f !== null);

  const findings = candidates
    .sort((a, b) => b.difference - a.difference || b.headline - a.headline || a.label.localeCompare(b.label))
    .slice(0, MAX_FINDINGS)
    .map(({ kind, label, top, low, evidence }) => ({ kind, label, top, low, evidence }));

  return {
    category,
    radiusM: PROFILE_RADIUS_M,
    businessIds: [...top.competitors, ...low.competitors].map((c) => c.id),
    reviewCount: top.reviewIds.length + low.reviewIds.length,
    findings,
  };
}

// The label for a set of reviews about one topic, given each review's tags on it. A count covers every
// review on the topic, so a detail can only stand for them when at least half share it; otherwise the
// topic does. Without this, one reviewer's "ruined pants" would read as 14 reviews' complaint.
export function topicLabel(topic: Topic, tagsPerReview: ReviewTag[][]): string {
  const details = tagsPerReview.flatMap((tags) => [...new Set(tags.map((t) => normalize(t.detail)))]);
  const common = mostCommon(details);
  return common && common.count >= tagsPerReview.length * MIN_LABEL_SHARE ? common.value : TOPIC_LABELS[topic];
}

// Ranks competitors with a rating and reviews by rating, then review count, and returns the top and
// bottom thirds with their review ids. null when fewer than MIN_REVIEWED_COMPETITORS qualify.
function rankGroups(competitors: ProfileCompetitor[], reviews: SourceDoc[]): { top: Group; low: Group } | null {
  const reviewsByCompetitor = new Map<string, string[]>();
  for (const doc of reviews) {
    const owner = doc.source === "review" ? competitorIdOf(doc.id) : null;
    if (!owner) continue;
    const ids = reviewsByCompetitor.get(owner) ?? [];
    if (!ids.includes(doc.id)) ids.push(doc.id);
    reviewsByCompetitor.set(owner, ids);
  }

  const unique = [...new Map(competitors.map((c) => [c.id, c])).values()];
  const ranked = unique
    .filter((c) => c.rating !== undefined && reviewsByCompetitor.has(c.id))
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0) || a.id.localeCompare(b.id),
    );
  if (ranked.length < MIN_REVIEWED_COMPETITORS) return null;

  const size = Math.floor(ranked.length / 3);
  const group = (list: ProfileCompetitor[]): Group => ({
    competitors: list,
    reviewIds: list.flatMap((c) => reviewsByCompetitor.get(c.id) ?? []),
  });
  return { top: group(ranked.slice(0, size)), low: group(ranked.slice(-size)) };
}

// Praise is about the top third and complaints about the bottom third: "Top-rated: drop-off service
// praised in 8 of 12 reviews", "Others: hours complained about in 6 of 9". Each review counts once.
function topicFinding(
  kind: Sentiment,
  topic: Topic,
  top: Group,
  low: Group,
  tagsByReview: Map<string, ReviewTag[]>,
): Scored | null {
  const matches = (reviewId: string) =>
    (tagsByReview.get(reviewId) ?? []).filter((t) => t.topic === topic && t.sentiment === kind);
  const topIds = top.reviewIds.filter((id) => matches(id).length > 0);
  const lowIds = low.reviewIds.filter((id) => matches(id).length > 0);
  const leadIds = kind === "praise" ? topIds : lowIds;
  if (leadIds.length < MIN_TOPIC_MENTIONS) return null;

  const topShare = topIds.length / top.reviewIds.length;
  const lowShare = lowIds.length / low.reviewIds.length;
  const difference = kind === "praise" ? topShare - lowShare : lowShare - topShare;
  if (difference < MIN_TOPIC_DIFFERENCE - EPSILON) return null;

  const label = topicLabel(topic, leadIds.map(matches));
  // Reviews whose own detail matches the label make the best evidence.
  const hasLabel = (id: string) => matches(id).some((t) => normalize(t.detail) === label);
  const evidence = spreadOut([...leadIds.filter(hasLabel), ...leadIds.filter((id) => !hasLabel(id))]);

  return {
    kind,
    label,
    top: { count: topIds.length, of: top.reviewIds.length },
    low: { count: lowIds.length, of: low.reviewIds.length },
    evidence,
    difference,
    headline: leadIds.length,
  };
}

// Shares are of the businesses whose value is known, so a field Places didn't return counts as neither.
function attributeFinding(
  attribute: (typeof ATTRIBUTES)[number],
  top: Group,
  low: Group,
): Scored | null {
  const known = (g: Group) => g.competitors.filter((c) => attribute.has(c) !== undefined);
  const having = (g: Group) => g.competitors.filter((c) => attribute.has(c) === true);
  const topKnown = known(top).length;
  const lowKnown = known(low).length;
  if (topKnown < MIN_KNOWN_PER_GROUP || lowKnown < MIN_KNOWN_PER_GROUP) return null;

  const topHaving = having(top);
  const lowHaving = having(low);
  const topShare = topHaving.length / topKnown;
  const lowShare = lowHaving.length / lowKnown;
  const difference = Math.abs(topShare - lowShare);
  if (difference < MIN_ATTRIBUTE_DIFFERENCE - EPSILON) return null;

  // Evidence comes from the group where the attribute is more common.
  const lead = topShare >= lowShare ? topHaving : lowHaving;
  return {
    kind: "attribute",
    label: attribute.label,
    top: { count: topHaving.length, of: topKnown },
    low: { count: lowHaving.length, of: lowKnown },
    evidence: lead.slice(0, MAX_EVIDENCE).map((c) => c.id),
    difference,
    headline: lead.length,
  };
}

// A finding in the card's words: "Top-rated: drop-off service praised in 8 of 12 reviews (others: 1 of 9)."
export function describeFinding(f: ProfileFinding): string {
  if (f.kind === "praise") {
    return `Top-rated: ${f.label} praised in ${f.top.count} of ${f.top.of} reviews (others: ${f.low.count} of ${f.low.of}).`;
  }
  if (f.kind === "complaint") {
    return `Others: ${f.label} complained about in ${f.low.count} of ${f.low.of} reviews (top-rated: ${f.top.count} of ${f.top.of}).`;
  }
  const topLeads = f.top.count / f.top.of >= f.low.count / f.low.of;
  return topLeads
    ? `Top-rated: ${f.top.count} of ${f.top.of} ${f.label} (others: ${f.low.count} of ${f.low.of}).`
    : `Others: ${f.low.count} of ${f.low.of} ${f.label} (top-rated: ${f.top.count} of ${f.top.of}).`;
}

// "review:<place id>:<n>" -> "places:<place id>", the convention in src/lib/types.ts.
function competitorIdOf(reviewId: string): string | null {
  const match = /^review:(.+):\d+$/.exec(reviewId);
  return match ? `places:${match[1]}` : null;
}

// Up to MAX_EVIDENCE review ids in order of preference, one per business before any business gets two.
function spreadOut(reviewIds: string[]): string[] {
  const owners = new Set<string | null>();
  const firsts = reviewIds.filter((id) => {
    const owner = competitorIdOf(id);
    if (owners.has(owner)) return false;
    owners.add(owner);
    return true;
  });
  return [...firsts, ...reviewIds.filter((id) => !firsts.includes(id))].slice(0, MAX_EVIDENCE);
}

// The most frequent value; ties go to the one seen first.
function mostCommon(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
}

const normalize = (detail: string) => detail.toLowerCase().replace(/\s+/g, " ").trim();

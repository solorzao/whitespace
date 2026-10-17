// The fixed list of review topics, so code can count them. Each tag also carries a short detail,
// such as "drop-off service", which becomes the finding's label.

export const TOPICS = [
  "price",
  "quality",
  "selection",
  "service",
  "staff",
  "wait",
  "hours",
  "cleanliness",
  "space",
  "atmosphere",
  "location",
  "other",
] as const;

export type Topic = (typeof TOPICS)[number];

// What each topic covers, for the tagging prompt.
export const TOPIC_DESCRIPTIONS: Record<Topic, string> = {
  price: "cost and value for money",
  quality: "how well the main product or service is done, and the state of the equipment",
  selection: "the range of products or services on offer",
  service: "how the service works: ordering, options such as drop-off, delivery or pickup, and payment",
  staff: "how the people working there behave: friendliness, helpfulness, competence",
  wait: "waiting times and speed",
  hours: "opening hours",
  cleanliness: "how clean the place and its equipment are",
  space: "room, seating and crowding inside",
  atmosphere: "the feel of the place: music, decor, mood, safety",
  location: "where it is, access and parking",
  other: "anything specific that fits none of the above",
};

const TOPIC_SET = new Set<string>(TOPICS);

export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && TOPIC_SET.has(value);
}

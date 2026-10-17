// Sample responses for building the UI before the real pipeline is ready.
// Every name, number and review here is made up; only the Wikipedia and Census links are real pages.

import type { AnalyzeResponse, AskResponse, LatLng, SourceDoc } from "../types";

// Set WHITESPACE_MOCK=1 to serve these from /api/analyze and /api/ask. CI's e2e run sets it.
export function useMocks(): boolean {
  return process.env.WHITESPACE_MOCK === "1";
}

const CENTER: LatLng = { lat: 34.0195, lng: -118.4912 };

const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/#map=19/${lat}/${lng}`;
const placeUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const tractUrl = (fips: string) => `https://data.census.gov/profile?g=1400000US${fips}`;

const BUSINESSES: AnalyzeResponse["businesses"] = [
  { id: "osm:node/9000000001", name: "Fourth Street Grocer", category: "grocery", lat: 34.0201, lng: -118.4921, url: mapUrl(34.0201, -118.4921) },
  { id: "osm:node/9000000002", name: "Wilshire Coffee Bar", category: "cafe", lat: 34.0189, lng: -118.4899, url: mapUrl(34.0189, -118.4899) },
  { id: "osm:node/9000000003", name: "Pier Street Burgers", category: "fast_food", lat: 34.0162, lng: -118.4955, url: mapUrl(34.0162, -118.4955) },
  { id: "osm:node/9000000004", name: "Arizona Avenue Bistro", category: "restaurant", lat: 34.0178, lng: -118.494, url: mapUrl(34.0178, -118.494) },
  { id: "osm:node/9000000005", name: "Second Street Noodles", category: "restaurant", lat: 34.0172, lng: -118.4968, url: mapUrl(34.0172, -118.4968) },
  { id: "osm:node/9000000006", name: "Seaside Taqueria", category: "restaurant", lat: 34.0214, lng: -118.4951, url: mapUrl(34.0214, -118.4951) },
  { id: "osm:node/9000000007", name: "Montana Tea House", category: "cafe", lat: 34.0226, lng: -118.4902, url: mapUrl(34.0226, -118.4902) },
  { id: "osm:node/9000000008", name: "The Salt Room", category: "bar", lat: 34.0168, lng: -118.4931, url: mapUrl(34.0168, -118.4931) },
  { id: "osm:node/9000000009", name: "Breakwater Tap", category: "bar", lat: 34.0158, lng: -118.4917, url: mapUrl(34.0158, -118.4917) },
  { id: "osm:node/9000000010", name: "Palisade Outfitters", category: "clothing", lat: 34.0175, lng: -118.4958, url: mapUrl(34.0175, -118.4958) },
  { id: "osm:node/9000000011", name: "Tidewater Threads", category: "clothing", lat: 34.0166, lng: -118.4962, url: mapUrl(34.0166, -118.4962) },
  { id: "osm:node/9000000012", name: "Shoreline Salon", category: "hair_beauty", lat: 34.0208, lng: -118.4885, url: mapUrl(34.0208, -118.4885) },
  { id: "osm:node/9000000013", name: "Ocean Park Pharmacy", category: "pharmacy", lat: 34.0221, lng: -118.4935, url: mapUrl(34.0221, -118.4935) },
  { id: "osm:node/9000000014", name: "Coastline Credit Union", category: "bank", lat: 34.0193, lng: -118.4878, url: mapUrl(34.0193, -118.4878) },
  { id: "osm:node/9000000015", name: "Sunset Strength Studio", category: "fitness", lat: 34.0233, lng: -118.4921, url: mapUrl(34.0233, -118.4921) },
  { id: "places:sample-ocean-kitchen", name: "Ocean Avenue Kitchen", category: "restaurant", lat: 34.0183, lng: -118.4977, rating: 4.5, status: "open", url: placeUrl(34.0183, -118.4977) },
  { id: "places:sample-corner-books", name: "Corner Page Books", category: "books", lat: 34.0199, lng: -118.4948, rating: 4.7, status: "closed_permanently", url: placeUrl(34.0199, -118.4948) },
];

const TRACTS = [
  { fips: "06037701801", population: 3420, renters: 81 },
  { fips: "06037701902", population: 3610, renters: 77 },
  { fips: "06037702000", population: 2810, renters: 74 },
];

const DOCS: SourceDoc[] = [
  ...BUSINESSES.map(
    (b): SourceDoc => ({
      id: b.id,
      source: b.id.startsWith("places:") ? "places" : "osm",
      url: b.url,
      title: b.name,
      text:
        b.rating !== undefined
          ? `${b.name}, a ${b.category.replace("_", " ")} business rated ${b.rating} on Google${b.status === "closed_permanently" ? ", now permanently closed" : ""}.`
          : `${b.name}, a ${b.category.replace("_", " ")} business mapped in OpenStreetMap.`,
      lat: b.lat,
      lng: b.lng,
      category: b.category,
    }),
  ),
  ...TRACTS.map(
    (t): SourceDoc => ({
      id: `census:${t.fips}`,
      source: "census",
      url: tractUrl(t.fips),
      title: `Census tract ${t.fips}`,
      text: `ACS 5-year estimates for tract ${t.fips}: population ${t.population}, ${t.renters}% of households rent, median household income about $98,000.`,
    }),
  ),
  {
    id: "review:sample-ocean-kitchen:0",
    source: "review",
    url: placeUrl(34.0183, -118.4977),
    title: "Review of Ocean Avenue Kitchen",
    text: "Great food, but I live two blocks away and there is nowhere nearby to drop off laundry, so I end up driving across town every week.",
    lat: 34.0183,
    lng: -118.4977,
    category: "restaurant",
  },
  {
    id: "review:sample-corner-books:0",
    source: "review",
    url: placeUrl(34.0199, -118.4948),
    title: "Review of Corner Page Books",
    text: "Sad to see this close. The neighborhood has plenty of restaurants but almost nothing for families with young kids.",
    lat: 34.0199,
    lng: -118.4948,
    category: "books",
  },
  {
    id: "wikipedia:1080546",
    source: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Third_Street_Promenade",
    title: "Third Street Promenade",
    text: "A pedestrian shopping street in downtown Santa Monica, lined with retail chains, restaurants and street performers.",
    lat: 34.0161,
    lng: -118.4966,
  },
  {
    id: "wikipedia:108556",
    source: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Santa_Monica,_California",
    title: "Santa Monica, California",
    text: "A beachfront city in western Los Angeles County with a dense, largely renter-occupied downtown.",
    lat: 34.0194,
    lng: -118.4912,
  },
];

const ANALYSIS: AnalyzeResponse = {
  center: CENTER,
  radiusM: 800,
  demographics: {
    tractFips: TRACTS.map((t) => t.fips),
    population: TRACTS.reduce((sum, t) => sum + t.population, 0),
    medianIncome: 98500,
    medianAge: 39.2,
    medianRent: 2450,
    pctRenters: 78,
    pctWithKids: 14,
    pctNoVehicle: 18,
  },
  businesses: BUSINESSES,
  gaps: [
    { category: "laundry", localPer1k: 0, benchmarkPer1k: 0.21, score: 1.18 },
    { category: "childcare", localPer1k: 0, benchmarkPer1k: 0.16, score: 0.97 },
    { category: "hardware", localPer1k: 0, benchmarkPer1k: 0.12, score: 0.84 },
    { category: "books", localPer1k: 0, benchmarkPer1k: 0.11, score: 0.71 },
    { category: "specialty_food", localPer1k: 0.1, benchmarkPer1k: 0.34, score: 0.66 },
    { category: "grocery", localPer1k: 0.1, benchmarkPer1k: 0.22, score: 0.48 },
  ],
  concepts: [
    {
      title: "Laundromat with wash-and-fold pickup",
      category: "laundry",
      rationale:
        "About 78% of households rent and there is no laundromat or dry cleaner in the circle, against roughly two expected for this population.",
      evidence: ["census:06037701801", "census:06037701902", "review:sample-ocean-kitchen:0"],
      risk: "Many newer buildings have in-unit laundry, so demand may come mostly from older rentals.",
    },
    {
      title: "Drop-in childcare and preschool",
      category: "childcare",
      rationale:
        "No childcare is mapped within 800 m, and a reviewer notes the area has little for families with young kids.",
      evidence: ["census:06037702000", "review:sample-corner-books:0"],
      risk: "Only about 14% of households have children, and licensing takes months.",
    },
    {
      title: "Neighborhood hardware and home goods",
      category: "hardware",
      rationale:
        "Dense rentals need small repairs and supplies, but there is no hardware store in the circle.",
      evidence: ["census:06037701902", "wikipedia:108556"],
      risk: "Downtown rents are high for a low-margin store; a compact format would be needed.",
    },
  ],
  docs: DOCS,
};

// The sample is centered on the Santa Monica demo area; shift it so the dots surround any pin.
export function mockAnalysis(point: LatLng): AnalyzeResponse {
  const dLat = point.lat - CENTER.lat;
  const dLng = point.lng - CENTER.lng;
  const shift = <T extends { lat?: number; lng?: number }>(item: T): T =>
    item.lat === undefined || item.lng === undefined
      ? item
      : { ...item, lat: item.lat + dLat, lng: item.lng + dLng };
  return {
    ...ANALYSIS,
    center: point,
    businesses: ANALYSIS.businesses.map(shift),
    docs: ANALYSIS.docs.map(shift),
  };
}

// Answers mark citations inline as [1], [2], ..., numbered in the order of `citations`.
export function mockAnswer(question: string, docs: SourceDoc[]): AskResponse {
  const pick = (source: SourceDoc["source"]) => docs.find((d) => d.source === source);
  const cited = [pick("census"), pick("review")].filter((d): d is SourceDoc => d !== undefined);
  return {
    answer:
      `This is a sample answer to "${question}". ` +
      (cited.length === 2
        ? "Most households in the area rent [1], and a nearby reviewer says they drive across town to do laundry [2]."
        : "There isn't enough data in this area to answer it."),
    citations: cited.map(({ id, title, url }) => ({ id, title, url })),
  };
}

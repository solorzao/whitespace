// The 20 business categories, and how OpenStreetMap tags and Google place types map to them.
// The benchmark table and the map colors depend on these ids, so don't rename them.

export const CATEGORIES = [
  { id: "grocery", label: "Grocery" },
  { id: "specialty_food", label: "Specialty food" },
  { id: "convenience", label: "Convenience" },
  { id: "bakery", label: "Bakery" },
  { id: "restaurant", label: "Restaurant" },
  { id: "fast_food", label: "Fast food" },
  { id: "cafe", label: "Café" },
  { id: "bar", label: "Bar" },
  { id: "liquor", label: "Liquor" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "medical", label: "Medical" },
  { id: "laundry", label: "Laundry" },
  { id: "hair_beauty", label: "Hair and beauty" },
  { id: "fitness", label: "Fitness" },
  { id: "childcare", label: "Childcare" },
  { id: "pet", label: "Pet" },
  { id: "clothing", label: "Clothing" },
  { id: "hardware", label: "Hardware" },
  { id: "bank", label: "Bank" },
  { id: "books", label: "Books" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export const CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<CategoryId, string>;

export function emptyCounts(): Record<CategoryId, number> {
  return Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<CategoryId, number>;
}

// OpenStreetMap: key -> value -> category. Checked in this key order, so
// an element tagged both amenity=pharmacy and shop=chemist resolves once.
export const OSM_TAGS = {
  amenity: {
    restaurant: "restaurant",
    fast_food: "fast_food",
    food_court: "fast_food",
    ice_cream: "fast_food",
    cafe: "cafe",
    bar: "bar",
    pub: "bar",
    nightclub: "bar",
    biergarten: "bar",
    pharmacy: "pharmacy",
    doctors: "medical",
    dentist: "medical",
    clinic: "medical",
    childcare: "childcare",
    kindergarten: "childcare",
    veterinary: "pet",
    bank: "bank",
    gym: "fitness", // deprecated, but still in use
  },
  shop: {
    supermarket: "grocery",
    grocery: "grocery",
    butcher: "specialty_food",
    deli: "specialty_food",
    health_food: "specialty_food",
    cheese: "specialty_food",
    seafood: "specialty_food",
    greengrocer: "specialty_food",
    spices: "specialty_food",
    chocolate: "specialty_food",
    confectionery: "specialty_food",
    coffee: "specialty_food",
    convenience: "convenience",
    kiosk: "convenience",
    bakery: "bakery",
    pastry: "bakery",
    tea: "cafe",
    alcohol: "liquor",
    wine: "liquor",
    beverages: "liquor",
    chemist: "pharmacy",
    optician: "medical",
    laundry: "laundry",
    dry_cleaning: "laundry",
    hairdresser: "hair_beauty",
    beauty: "hair_beauty",
    cosmetics: "hair_beauty",
    pet: "pet",
    pet_grooming: "pet",
    clothes: "clothing",
    shoes: "clothing",
    boutique: "clothing",
    fashion_accessories: "clothing",
    hardware: "hardware",
    doityourself: "hardware",
    garden_centre: "hardware",
    paint: "hardware",
    books: "books",
  },
  leisure: {
    fitness_centre: "fitness",
  },
} as const satisfies Record<string, Record<string, CategoryId>>;

export type OsmKey = keyof typeof OSM_TAGS;

export const OSM_KEYS = Object.keys(OSM_TAGS) as OsmKey[];

// leisure=sports_centre is too broad on its own, so it only counts as fitness with one of these sports.
const FITNESS_SPORTS = new Set(["fitness", "yoga", "pilates", "crossfit", "boxing", "martial_arts"]);

export function categorizeOsm(tags: Record<string, string | undefined>): CategoryId | null {
  for (const key of OSM_KEYS) {
    const value = tags[key];
    if (!value) continue;
    const map: Record<string, CategoryId> = OSM_TAGS[key];
    if (map[value]) return map[value];
  }
  if (tags.leisure === "sports_centre") {
    const sports = (tags.sport ?? "").split(";").map((s) => s.trim());
    if (sports.some((s) => FITNESS_SPORTS.has(s))) return "fitness";
  }
  return null;
}

// Google Places (New) types from Table A, so every one is valid in includedTypes.
// Checked against developers.google.com/maps/documentation/places/web-service/place-types on 2026-10-17.
// Nearby Search allows at most 50 includedTypes; this is 48.
export const GOOGLE_TYPES = {
  supermarket: "grocery",
  grocery_store: "grocery",
  asian_grocery_store: "grocery",
  butcher_shop: "specialty_food",
  health_food_store: "specialty_food",
  deli: "specialty_food",
  convenience_store: "convenience",
  bakery: "bakery",
  pastry_shop: "bakery",
  restaurant: "restaurant",
  fast_food_restaurant: "fast_food",
  meal_takeaway: "fast_food",
  cafe: "cafe",
  coffee_shop: "cafe",
  tea_house: "cafe",
  bar: "bar",
  pub: "bar",
  night_club: "bar",
  wine_bar: "bar",
  liquor_store: "liquor",
  pharmacy: "pharmacy",
  drugstore: "pharmacy",
  doctor: "medical",
  dentist: "medical",
  dental_clinic: "medical",
  medical_clinic: "medical",
  laundry: "laundry",
  hair_salon: "hair_beauty",
  hair_care: "hair_beauty",
  barber_shop: "hair_beauty",
  beauty_salon: "hair_beauty",
  nail_salon: "hair_beauty",
  gym: "fitness",
  fitness_center: "fitness",
  yoga_studio: "fitness",
  child_care_agency: "childcare",
  preschool: "childcare",
  pet_store: "pet",
  pet_care: "pet",
  veterinary_care: "pet",
  clothing_store: "clothing",
  shoe_store: "clothing",
  hardware_store: "hardware",
  home_improvement_store: "hardware",
  garden_center: "hardware",
  building_materials_store: "hardware",
  bank: "bank",
  book_store: "books",
} as const satisfies Record<string, CategoryId>;

export const PLACES_INCLUDED_TYPES = Object.keys(GOOGLE_TYPES);

// The Google types for one category, for a Nearby Search limited to that category.
export function googleTypesFor(category: CategoryId): string[] {
  return Object.entries(GOOGLE_TYPES)
    .filter(([, c]) => c === category)
    .map(([type]) => type);
}

// Big draws that list our types among theirs (a hotel with a gym and a restaurant, a mall with
// clothing stores) but aren't the businesses we count. Excluding them leaves Nearby Search's
// 20 slots for businesses we can use.
export const PLACES_EXCLUDED_PRIMARY_TYPES = [
  "hotel",
  "lodging",
  "department_store",
  "shopping_mall",
  "museum",
  "movie_theater",
  "tourist_attraction",
  "observation_deck",
  "event_venue",
  "amusement_center",
];

// More specific types seen as primary types in results. Only used to categorize results.
const GOOGLE_EXTRA_TYPES: Record<string, CategoryId> = {
  donut_shop: "bakery",
  bagel_shop: "bakery",
  sandwich_shop: "fast_food",
  ice_cream_shop: "fast_food",
  juice_shop: "cafe",
  steak_house: "restaurant",
  diner: "restaurant",
  brewpub: "bar",
  cosmetics_store: "hair_beauty",
  sportswear_store: "clothing",
};

// Specific Google types we don't list one by one, such as italian_restaurant or cocktail_bar.
const GOOGLE_SUFFIXES: [string, CategoryId][] = [
  ["_restaurant", "restaurant"],
  ["_bar", "bar"],
  ["_pub", "bar"],
  ["_clothing_store", "clothing"],
];

function mapGoogleType(type: string): CategoryId | null {
  const map: Record<string, CategoryId> = GOOGLE_TYPES;
  if (map[type]) return map[type];
  if (GOOGLE_EXTRA_TYPES[type]) return GOOGLE_EXTRA_TYPES[type];
  for (const [suffix, category] of GOOGLE_SUFFIXES) if (type.endsWith(suffix)) return category;
  return null;
}

// The primary type decides. A place whose primary type is outside our categories is dropped,
// so a hotel that lists "gym" and "restaurant" among its types doesn't count as either.
// The type list is only used when there's no primary type.
export function categorizeGoogle(types: string[], primaryType?: string): CategoryId | null {
  if (primaryType) return mapGoogleType(primaryType);
  for (const t of types) {
    const category = mapGoogleType(t);
    if (category) return category;
  }
  return null;
}

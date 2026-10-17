// Tracts in the circle (TIGERweb) and their ACS 2020–2024 5-year demographics, combined for the circle.

import type { Demographics, LatLng, SourceDoc } from "../types";
import { isInCircle } from "./geo";
import { fetchJson } from "./http";
import { settle, type AdapterResult } from "./result";

const TIGER_TRACTS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query";
const ACS = "https://api.census.gov/data/2024/acs/acs5";
const ACS_LABEL = "ACS 2020–2024 5-year";

const VARS = {
  population: "B01003_001E",
  medianIncome: "B19013_001E",
  medianAge: "B01002_001E",
  medianRent: "B25064_001E",
  occupied: "B25003_001E",
  renters: "B25003_003E",
  households: "B11005_001E",
  withKids: "B11005_002E",
  vehicleHouseholds: "B08201_001E",
  noVehicle: "B08201_002E",
} as const;

type VarName = keyof typeof VARS;

type Tract = { geoid: string; state: string; county: string; tract: string; point: LatLng };

type TractData = { tract: Tract; name: string; values: Record<VarName, number | null> };

export type CensusData = { demographics: Demographics | null };

type TigerResponse = {
  features?: { attributes: Record<string, string> }[];
  error?: { message: string };
};

async function queryTracts(center: LatLng, distanceM?: number): Promise<Tract[]> {
  const params = new URLSearchParams({
    geometry: `${center.lng},${center.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "GEOID,STATE,COUNTY,TRACT,INTPTLAT,INTPTLON",
    returnGeometry: "false",
    f: "json",
  });
  if (distanceM) {
    params.set("distance", String(distanceM));
    params.set("units", "esriSRUnit_Meter");
  }
  const res = await fetchJson<TigerResponse>(`${TIGER_TRACTS}?${params}`, { timeoutMs: 15_000 });
  // ArcGIS reports errors in a 200 response.
  if (res.error) throw new Error(`TIGERweb: ${res.error.message}`);
  return (res.features ?? []).map(({ attributes: a }) => ({
    geoid: a.GEOID,
    state: a.STATE,
    county: a.COUNTY,
    tract: a.TRACT,
    point: { lat: Number(a.INTPTLAT), lng: Number(a.INTPTLON) },
  }));
}

// Tracts whose internal point is in the circle. If none are, the tract that contains the center.
async function findTracts(center: LatLng, radiusM: number): Promise<Tract[]> {
  const touching = await queryTracts(center, radiusM);
  if (touching.length === 0) return []; // outside the US
  const inside = touching.filter((t) => isInCircle(center, t.point, radiusM));
  if (inside.length > 0) return inside;
  return queryTracts(center);
}

// ACS uses large negative numbers such as -666666666 for "not available".
function toValue(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchAcs(tracts: Tract[], key: string): Promise<TractData[]> {
  const byCounty = new Map<string, Tract[]>();
  for (const t of tracts) {
    const k = `${t.state}:${t.county}`;
    byCounty.set(k, [...(byCounty.get(k) ?? []), t]);
  }
  const names = Object.keys(VARS) as VarName[];

  const perCounty = await Promise.all(
    [...byCounty.values()].map(async (group) => {
      const { state, county } = group[0];
      const params = new URLSearchParams({
        get: ["NAME", ...names.map((n) => VARS[n])].join(","),
        for: `tract:${group.map((t) => t.tract).join(",")}`,
        in: `state:${state} county:${county}`,
        key,
      });
      const rows = await fetchJson<(string | null)[][]>(`${ACS}?${params}`, { timeoutMs: 15_000 });
      const [header, ...data] = rows;
      const col = (name: string) => header.indexOf(name);
      return data.map((row): TractData => {
        const tract = group.find((t) => t.tract === row[col("tract")])!;
        const values = Object.fromEntries(
          names.map((n) => [n, toValue(row[col(VARS[n])])]),
        ) as Record<VarName, number | null>;
        return { tract, name: row[col("NAME")] ?? tract.geoid, values };
      });
    }),
  );
  return perCounty.flat();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function sum(rows: TractData[], v: VarName): number {
  return rows.reduce((s, r) => s + (r.values[v] ?? 0), 0);
}

function pct(rows: TractData[], part: VarName, whole: VarName): number | null {
  const total = sum(rows, whole);
  return total > 0 ? round1((100 * sum(rows, part)) / total) : null;
}

// Population-weighted average of tract medians. An estimate, not a true median.
// Dollar amounts round to whole dollars, age to one decimal.
function weightedMedian(rows: TractData[], v: VarName, round = Math.round): number | null {
  let weight = 0;
  let total = 0;
  for (const r of rows) {
    const value = r.values[v];
    const pop = r.values.population ?? 0;
    if (value === null || pop === 0) continue;
    weight += pop;
    total += value * pop;
  }
  return weight > 0 ? round(total / weight) : null;
}

export function combine(rows: TractData[]): Demographics {
  return {
    tractFips: rows.map((r) => r.tract.geoid),
    population: sum(rows, "population"),
    medianIncome: weightedMedian(rows, "medianIncome"),
    medianAge: weightedMedian(rows, "medianAge", round1),
    medianRent: weightedMedian(rows, "medianRent"),
    pctRenters: pct(rows, "renters", "occupied"),
    pctWithKids: pct(rows, "withKids", "households"),
    pctNoVehicle: pct(rows, "noVehicle", "vehicleHouseholds"),
  };
}

const fmt = (n: number | null, prefix = "") => (n === null ? "not available" : `${prefix}${n.toLocaleString("en-US")}`);
const share = (part: number | null, whole: number | null) =>
  part === null || !whole ? "not available" : `${round1((100 * part) / whole)}%`;

function tractDoc({ tract, name, values: v }: TractData): SourceDoc {
  return {
    id: `census:${tract.geoid}`,
    source: "census",
    url: `https://data.census.gov/profile?g=1400000US${tract.geoid}`,
    title: name,
    text: [
      `${name} (${ACS_LABEL}).`,
      `Population: ${fmt(v.population)}.`,
      `Median household income: ${fmt(v.medianIncome, "$")}.`,
      `Median age: ${fmt(v.medianAge)}.`,
      `Median gross rent: ${fmt(v.medianRent, "$")}.`,
      `Renter-occupied homes: ${share(v.renters, v.occupied)}.`,
      `Households with children under 18: ${share(v.withKids, v.households)}.`,
      `Households with no vehicle: ${share(v.noVehicle, v.vehicleHouseholds)}.`,
    ].join(" "),
    lat: tract.point.lat,
    lng: tract.point.lng,
  };
}

export function fetchCensus(lat: number, lng: number, radiusM: number): Promise<AdapterResult<CensusData>> {
  return settle<CensusData>(async () => {
    const tracts = await findTracts({ lat, lng }, radiusM);
    if (tracts.length === 0) return { docs: [], data: { demographics: null } };
    const key = process.env.CENSUS_API_KEY;
    if (!key) throw new Error("CENSUS_API_KEY is not set");
    const rows = await fetchAcs(tracts, key);
    if (rows.length === 0) return { docs: [], data: { demographics: null } };
    return { docs: rows.map(tractDoc), data: { demographics: combine(rows) } };
  });
}

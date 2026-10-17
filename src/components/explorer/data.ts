import type { SourceDoc } from "@/lib/types";
import { types } from "./map/sources";
import type { Analysis, MapRecord, Report } from "./types";

export function mapRecords(docs: SourceDoc[]): MapRecord[] {
  return docs.flatMap((doc) => {
    const type = types.findIndex((type) => type.id === doc.source);
    if (type < 0 || !Number.isFinite(doc.lat) || !Number.isFinite(doc.lng))
      return [];
    return [
      {
        id: doc.id,
        lat: doc.lat!,
        lon: doc.lng!,
        type,
        locationName: doc.title,
      },
    ];
  });
}

export function safeURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function isAnalysis(value: unknown): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const data = value as Analysis;
  return (
    !!data.center &&
    Number.isFinite(data.center.lat) &&
    Math.abs(data.center.lat) <= 90 &&
    Number.isFinite(data.center.lng) &&
    Math.abs(data.center.lng) <= 180 &&
    Number.isFinite(data.radiusM) &&
    data.radiusM > 0 &&
    (data.demographics === null ||
      (!!data.demographics && Number.isFinite(data.demographics.population))) &&
    Array.isArray(data.docs) &&
    data.docs.every(
      (doc) =>
        doc &&
        [doc.id, doc.source, doc.url, doc.title, doc.text].every(
          (field) => typeof field === "string",
        ),
    ) &&
    Array.isArray(data.businesses) &&
    data.businesses.every(
      (b) =>
        b &&
        typeof b.id === "string" &&
        typeof b.name === "string" &&
        typeof b.category === "string" &&
        typeof b.url === "string" &&
        Number.isFinite(b.lat) && Number.isFinite(b.lng) &&
        (b.rating === undefined || Number.isFinite(b.rating)) &&
        (b.status === undefined || typeof b.status === "string"),
    ) &&
    Array.isArray(data.gaps) &&
    data.gaps.every(
      (g) =>
        g &&
        typeof g.category === "string" &&
        [g.localPer1k, g.benchmarkPer1k, g.score].every(Number.isFinite),
    ) &&
    Array.isArray(data.concepts) &&
    data.concepts.every(
      (c) =>
        c &&
        [c.title, c.category, c.rationale, c.risk].every(
          (field) => typeof field === "string",
        ) &&
        Array.isArray(c.evidence) &&
        c.evidence.every((id) => typeof id === "string"),
    ) &&
    (data.errors === undefined || (Array.isArray(data.errors) && data.errors.every(issue => issue && typeof issue.source === 'string'))) &&
    (data.profiles === undefined || (Array.isArray(data.profiles) && data.profiles.every(profile =>
      profile && typeof profile.category === 'string' && Number.isFinite(profile.radiusM) && Number.isFinite(profile.reviewCount) &&
      Array.isArray(profile.findings) && profile.findings.every(finding => finding && typeof finding.label === 'string' &&
        !!finding.top && !!finding.low && [finding.top.count, finding.top.of, finding.low.count, finding.low.of].every(Number.isFinite) &&
        Array.isArray(finding.evidence) && finding.evidence.every(id => typeof id === 'string')))))
  );
}

const HISTORY_KEY = "whitespace.reports.v1";
type StoredTurn = {
  question?: unknown;
  response?: {
    answer?: unknown;
    citations?: { id: string; title: string; url: string }[];
  };
};
export function readReports(storage: Pick<Storage, "getItem">): Report[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (report): report is Report =>
          report &&
          typeof report.id === "string" &&
          typeof report.name === "string" &&
          typeof report.question === "string" &&
          typeof report.createdAt === "string" &&
          !Number.isNaN(Date.parse(report.createdAt)) &&
          isAnalysis(report.analysis) &&
          Array.isArray(report.conversation) &&
          report.conversation.every(
            (turn: StoredTurn) =>
              turn &&
              typeof turn.question === "string" &&
              typeof turn.response?.answer === "string" &&
              Array.isArray(turn.response.citations) &&
              turn.response.citations.every(
                (c) =>
                  c &&
                  [c.id, c.title, c.url].every(
                    (field) => typeof field === "string",
                  ),
              ),
          ),
      )
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function saveReports(
  storage: Pick<Storage, "setItem">,
  reports: Report[],
): boolean {
  try {
    const kept = reports.slice(0, 6);
    while (kept.length && JSON.stringify(kept).length > 1_500_000) kept.pop();
    storage.setItem(HISTORY_KEY, JSON.stringify(kept));
    return kept.length > 0 || reports.length === 0;
  } catch {
    return false;
  }
}

export async function requestJSON<T>(
  url: string,
  data: unknown,
  signal: AbortSignal,
  timeout = 135_000,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body?.error || `Request failed (${response.status}). Please try again.`,
    );
  if (!body)
    throw new Error("The server returned an empty response. Please try again.");
  return body as T;
}

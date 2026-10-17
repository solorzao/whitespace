import type { AnalysisResult } from "@/lib/analysis";
import type { AnalyzeResponse, AreaData, AskResponse } from "@/lib/types";

export type MapPoint = {
  lat: number;
  lon: number;
  name?: string;
  x?: number;
  y?: number;
};
export type MapRecord = {
  id: string;
  lat: number;
  lon: number;
  type: number;
  locationName: string;
};
export type AreaResult = AreaData & {
  from: "saved" | "live" | "mock";
  demoArea?: string;
  mock?: boolean;
};
export type Analysis = AnalyzeResponse &
  Partial<
    Pick<
      AnalysisResult,
      "competitors" | "profiles" | "errors" | "from" | "demoArea"
    >
  > & { mock?: boolean };
export type Conversation = { question: string; response: AskResponse };
export type Report = {
  id: string;
  name: string;
  question: string;
  createdAt: string;
  analysis: Analysis;
  conversation: Conversation[];
};
export type AreaIndex = {
  areas: {
    slug: string;
    name: string;
    center: { lat: number; lng: number };
    available: boolean;
  }[];
  records: MapRecord[];
};

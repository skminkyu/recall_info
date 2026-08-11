export type SourceType = "domestic" | "overseas";

export interface NormalizedRecall {
  id: string;
  source_type: SourceType;
  source_code: string;
  external_id: string;
  title: string;
  title_original: string | null;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  hazard: string | null;
  hazard_original: string | null;
  risk_level: string | null;
  corrective_action: string | null;
  country: string | null;
  published_date: string | null;
  source_url: string | null;
  image_urls: string[];
  korea_relevance: boolean | null;
  raw: unknown;
}

export interface RecallRow extends Omit<NormalizedRecall, "image_urls" | "raw" | "korea_relevance"> {
  image_urls: string;
  raw_json: string;
  korea_relevance: 0 | 1 | null;
  created_at: string;
  updated_at: string;
}

export type MatchRequestStatus = "pending" | "processing" | "completed" | "failed";

export interface MatchCandidate {
  recall_id: string;
  source_type: SourceType;
  source_code: string;
  title: string;
  brand: string | null;
  model: string | null;
  similarity: number | null;
  reason: string | null;
  url: string | null;
  image_url: string | null;
}

export interface MatchRequestRow {
  id: string;
  image_path: string;
  status: MatchRequestStatus;
  note: string | null;
  analysis_json: string | null;
  candidates_json: string | null;
  created_at: string;
  updated_at: string;
}

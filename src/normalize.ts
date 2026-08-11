import { NormalizedRecall } from "./types";

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function joinNonEmpty(separator: string, ...values: Array<unknown>): string | null {
  const parts = values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return parts.length > 0 ? parts.join(separator) : null;
}

/**
 * Some MCP tools (fetch/get_recall_detail) return a single record wrapped
 * as `{ data: {...} }` rather than the bare item found inside a search
 * result's `data` array. Unwrap it so both shapes normalize the same way.
 */
function unwrapSingle(raw: any): any {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.data && typeof raw.data === "object") {
    return raw.data;
  }
  return raw;
}

function toImageUrls(...groups: Array<unknown>): string[] {
  const urls: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    if (typeof group === "string") {
      urls.push(group);
      continue;
    }
    if (Array.isArray(group)) {
      for (const item of group) {
        if (typeof item === "string") urls.push(item);
        else if (item && typeof item === "object" && typeof (item as any).url === "string") {
          urls.push((item as any).url);
        }
      }
    }
  }
  return [...new Set(urls)];
}

/**
 * Normalizes a raw record from the domestic recall MCP (SafetyKorea /
 * 한국제품안전협회 source: mcp__MCP__list_recent_recalls / search / fetch).
 */
export function normalizeDomestic(rawInput: any): NormalizedRecall {
  const raw = unwrapSingle(rawInput);
  const externalId = String(raw.recall_uid ?? raw.id ?? "");
  const sourceCode = "KR";
  const product = raw.product ?? {};
  const hazard = raw.hazard ?? {};
  const correctiveAction = raw.corrective_action ?? {};
  const source = raw.source ?? {};

  return {
    id: `domestic:${sourceCode}:${externalId}`,
    source_type: "domestic",
    source_code: sourceCode,
    external_id: externalId,
    title: firstNonEmpty(product.name, product.name_original) ?? "(제목 없음)",
    title_original: firstNonEmpty(product.name_original),
    brand: firstNonEmpty(product.brand),
    model: Array.isArray(product.model_numbers) && product.model_numbers.length > 0
      ? product.model_numbers.join(", ")
      : null,
    manufacturer: firstNonEmpty(product.manufacturer),
    hazard: firstNonEmpty(hazard.description),
    hazard_original: firstNonEmpty(hazard.description_original),
    risk_level: null,
    corrective_action: firstNonEmpty(correctiveAction.description),
    country: firstNonEmpty(raw.country) ?? sourceCode,
    published_date: firstNonEmpty(
      raw.publication_date,
      typeof raw.published_at === "string" ? raw.published_at.slice(0, 10) : null
    ),
    source_url: firstNonEmpty(source.url),
    image_urls: toImageUrls(raw.images),
    korea_relevance: true,
    raw,
  };
}

const OVERSEAS_SOURCE_LABELS: Record<string, string> = {
  AU: "호주",
  CA: "캐나다",
  CN: "중국",
  EN: "영국",
  EU: "유럽연합",
  FR: "프랑스",
  GE: "독일",
  JP_METI: "일본(METI)",
  JP_RECALLPLUS: "일본(RECALL PLUS)",
  NZ: "뉴질랜드",
  OECD: "OECD",
  US_CPSC: "미국(CPSC)",
  US_NHTSA: "미국(NHTSA)",
};

/**
 * Normalizes a raw record from the overseas recall MCP (13 government
 * sources: mcp__MCP-c805d72e__search_recalls / find_recalls_by_model /
 * get_recall_detail).
 */
export function normalizeOverseas(rawInput: any): NormalizedRecall {
  const raw = unwrapSingle(rawInput);
  const sourceCode = String(raw.source ?? "");
  const externalId = String(raw.guid ?? raw.id ?? "");

  // get_recall_detail includes a country of manufacture and a fuller
  // remedy description (remedy_type + consumer_action) that the lighter
  // search_recalls/find_recalls_by_model results don't carry.
  const manufacturer = joinNonEmpty(
    " · ",
    firstNonEmpty(raw.manufacturer_name, raw.manufacturer),
    raw.country_of_origin ? `제조국: ${raw.country_of_origin}` : null
  );
  const correctiveAction = firstNonEmpty(raw.corrective_action, raw.remedy) ??
    joinNonEmpty("\n", raw.remedy_type, raw.consumer_action);

  return {
    id: `overseas:${sourceCode}:${externalId}`,
    source_type: "overseas",
    source_code: sourceCode,
    external_id: externalId,
    title: firstNonEmpty(raw.product_name, raw.product_name_original) ?? "(제목 없음)",
    title_original: firstNonEmpty(raw.product_name_original),
    brand: firstNonEmpty(raw.brand_name),
    model: firstNonEmpty(raw.model_name),
    manufacturer,
    hazard: firstNonEmpty(raw.hazard_description, raw.hazard_type, raw.recall_cause),
    hazard_original: firstNonEmpty(raw.hazard_description_original),
    risk_level: firstNonEmpty(raw.risk_level),
    corrective_action: correctiveAction,
    country: firstNonEmpty(raw.recall_country, OVERSEAS_SOURCE_LABELS[sourceCode]),
    published_date: firstNonEmpty(raw.published_date),
    source_url: firstNonEmpty(raw.source_url),
    image_urls: toImageUrls(raw.image_1, raw.image_2, raw.image_3, raw.image_4, raw.image_5, raw.images),
    korea_relevance: typeof raw.korea_relevance === "boolean" ? raw.korea_relevance : null,
    raw,
  };
}

export function normalize(sourceType: "domestic" | "overseas", raw: any): NormalizedRecall {
  return sourceType === "domestic" ? normalizeDomestic(raw) : normalizeOverseas(raw);
}

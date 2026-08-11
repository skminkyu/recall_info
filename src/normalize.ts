import { NormalizedRecall } from "./types";

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
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
export function normalizeDomestic(raw: any): NormalizedRecall {
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
export function normalizeOverseas(raw: any): NormalizedRecall {
  const sourceCode = String(raw.source ?? "");
  const externalId = String(raw.guid ?? raw.id ?? "");

  return {
    id: `overseas:${sourceCode}:${externalId}`,
    source_type: "overseas",
    source_code: sourceCode,
    external_id: externalId,
    title: firstNonEmpty(raw.product_name, raw.product_name_original) ?? "(제목 없음)",
    title_original: firstNonEmpty(raw.product_name_original),
    brand: firstNonEmpty(raw.brand_name),
    model: firstNonEmpty(raw.model_name),
    manufacturer: firstNonEmpty(raw.manufacturer, raw.manufacturer_name),
    hazard: firstNonEmpty(raw.hazard_description, raw.hazard_type),
    hazard_original: null,
    risk_level: firstNonEmpty(raw.risk_level),
    corrective_action: firstNonEmpty(raw.corrective_action, raw.remedy),
    country: firstNonEmpty(raw.recall_country, OVERSEAS_SOURCE_LABELS[sourceCode]),
    published_date: firstNonEmpty(raw.published_date),
    source_url: firstNonEmpty(raw.source_url),
    image_urls: toImageUrls(raw.image_1, raw.images),
    korea_relevance: typeof raw.korea_relevance === "boolean" ? raw.korea_relevance : null,
    raw,
  };
}

export function normalize(sourceType: "domestic" | "overseas", raw: any): NormalizedRecall {
  return sourceType === "domestic" ? normalizeDomestic(raw) : normalizeOverseas(raw);
}

import { db } from "./db";
import { MatchCandidate } from "./types";
import { ProductAnalysis } from "./vision";

const MAX_TERMS = 15;
const MIN_TERM_LENGTH = 2;

function collectTerms(analysis: ProductAnalysis): string[] {
  const raw = [analysis.name, analysis.brand, analysis.model, analysis.category, ...analysis.keywords, ...analysis.markings];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const term = value.trim();
    if (term.length < MIN_TERM_LENGTH || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

function buildFtsQuery(terms: string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" OR ");
}

/**
 * Finds recalls whose title/brand/model/manufacturer/hazard text overlaps
 * with keywords extracted from a product photo, ranked by FTS5 bm25
 * relevance. This is a text-similarity proxy, not true image similarity —
 * there is no embedding index over recall images, so this is the closest
 * "유사도" signal available without one.
 */
export function findSimilarRecalls(analysis: ProductAnalysis, limit = 8): MatchCandidate[] {
  const terms = collectTerms(analysis);
  if (terms.length === 0) return [];

  const ftsQuery = buildFtsQuery(terms);

  let rows: any[];
  try {
    rows = db
      .prepare(
        `SELECT recalls.*, bm25(recalls_fts) AS rank
         FROM recalls_fts
         JOIN recalls ON recalls.rowid = recalls_fts.rowid
         WHERE recalls_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ?`
      )
      .all(ftsQuery, limit);
  } catch {
    return [];
  }

  return rows.map((row, index) => {
    const imageUrls: string[] = JSON.parse(row.image_urls ?? "[]");
    return {
      recall_id: row.id,
      source_type: row.source_type,
      source_code: row.source_code,
      title: row.title,
      brand: row.brand,
      model: row.model,
      similarity: Math.max(0.3, Number((0.95 - index * 0.08).toFixed(2))),
      reason: "제품명/브랜드/키워드 텍스트 유사도 기반 (이미지 임베딩 비교 아님)",
      url: row.source_url,
      image_url: imageUrls[0] ?? null,
    } satisfies MatchCandidate;
  });
}

import { db } from "./db";
import { MatchCandidate } from "./types";
import { ProductAnalysis } from "./vision";

const MAX_TERMS = 20;
const MIN_TERM_LENGTH = 2;

// Korean recall titles use inconsistent color vocabulary (e.g. "그린" vs
// "녹색"). Expand each extracted color into its common synonyms so a color
// shared with a recall's title can still match even when the exact word
// differs — this is what let a visually-similar-but-differently-named
// product (e.g. a dark green cylindrical device) surface a weak match
// against an unrelated recall that merely shares that color in its title.
const COLOR_SYNONYMS: Record<string, string[]> = {
  그린: ["녹색"], 녹색: ["그린"],
  화이트: ["흰색", "백색"], 흰색: ["화이트"],
  블랙: ["검정", "검은색"], 검정: ["블랙"],
  레드: ["빨간색", "적색"], 빨간색: ["레드"],
  블루: ["파란색", "청색"], 파란색: ["블루"],
  옐로우: ["노란색"], 노란색: ["옐로우"],
  핑크: ["분홍색"], 분홍색: ["핑크"],
  그레이: ["회색"], 회색: ["그레이"],
  브라운: ["갈색"], 갈색: ["브라운"],
  퍼플: ["보라색"], 보라색: ["퍼플"],
  오렌지: ["주황색"], 주황색: ["오렌지"],
};

function expandColorTerm(color: string): string[] {
  // "다크그린" 처럼 수식어가 붙은 색상명에서도 기본 색상 단어를 뽑아낸다.
  const base = Object.keys(COLOR_SYNONYMS).find((key) => color.includes(key));
  if (!base) return [color];
  return [base, ...COLOR_SYNONYMS[base]];
}

function collectTerms(analysis: ProductAnalysis): string[] {
  const colorTerms = analysis.colors.flatMap(expandColorTerm);
  const raw = [
    analysis.name,
    analysis.brand,
    analysis.model,
    analysis.category,
    ...analysis.keywords,
    ...analysis.markings,
    ...colorTerms,
  ];

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

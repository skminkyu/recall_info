import { Router } from "express";
import { db, rowToRecall } from "../db";
import { normalize } from "../normalize";
import { NormalizedRecall } from "../types";

export const recallsRouter = Router();

const MAX_LIMIT = 100;

recallsRouter.get("/", (req, res) => {
  const {
    q,
    source_type,
    source_code,
    brand,
    date_from,
    date_to,
    limit: limitRaw,
    offset: offsetRaw,
  } = req.query as Record<string, string | undefined>;

  const limit = Math.min(Number(limitRaw) || 20, MAX_LIMIT);
  const offset = Math.max(Number(offsetRaw) || 0, 0);

  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  let idsFromFts: Set<string> | null = null;
  if (q && q.trim().length > 0) {
    const ftsRows = db
      .prepare(`SELECT id FROM recalls_fts WHERE recalls_fts MATCH ? LIMIT 500`)
      .all(q.trim().split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"*`).join(" "));
    idsFromFts = new Set(ftsRows.map((r: any) => r.id));
    if (idsFromFts.size === 0) {
      return res.json({ data: [], total: 0, limit, offset });
    }
  }

  if (source_type) {
    conditions.push("source_type = @source_type");
    params.source_type = source_type;
  }
  if (source_code) {
    conditions.push("source_code = @source_code");
    params.source_code = source_code;
  }
  if (brand) {
    conditions.push("brand LIKE @brand");
    params.brand = `%${brand}%`;
  }
  if (date_from) {
    conditions.push("published_date >= @date_from");
    params.date_from = date_from;
  }
  if (date_to) {
    conditions.push("published_date <= @date_to");
    params.date_to = date_to;
  }
  if (idsFromFts) {
    const idList = [...idsFromFts];
    const placeholders = idList.map((_, i) => `@fts_id_${i}`);
    idList.forEach((id, i) => (params[`fts_id_${i}`] = id));
    conditions.push(`id IN (${placeholders.join(",")})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM recalls ${whereClause}`).get(params) as any).c;
  const rows = db
    .prepare(
      `SELECT * FROM recalls ${whereClause} ORDER BY published_date DESC, created_at DESC LIMIT @limit OFFSET @offset`
    )
    .all(params) as import("../types").RecallRow[];

  res.json({ data: rows.map(rowToRecall), total, limit, offset });
});

recallsRouter.get("/stats", (_req, res) => {
  const bySource = db
    .prepare(`SELECT source_type, source_code, COUNT(*) AS count FROM recalls GROUP BY source_type, source_code ORDER BY count DESC`)
    .all();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM recalls`).get() as any).c;
  const latest = db.prepare(`SELECT MAX(published_date) AS d FROM recalls`).get() as any;
  res.json({ total, by_source: bySource, latest_published_date: latest?.d ?? null });
});

recallsRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM recalls WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(rowToRecall(row as any));
});

export function normalizeAndValidate(sourceType: "domestic" | "overseas", rawItems: unknown[]): NormalizedRecall[] {
  if (!Array.isArray(rawItems)) throw new Error("raw must be an array");
  return rawItems.map((item) => normalize(sourceType, item));
}

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { NormalizedRecall, RecallRow, MatchRequestRow } from "./types";

// Resolved from the process's working directory (always the repo root when
// started via the npm scripts) rather than __dirname, since __dirname's
// depth differs between `tsx src/db.ts` (dev) and the tsc-compiled
// `dist/src/db.js` (production) — process.cwd() is stable across both.
const DATA_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.RECALL_DB_PATH ?? path.join(DATA_DIR, "recall_info.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS recalls (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('domestic', 'overseas')),
  source_code TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_original TEXT,
  brand TEXT,
  model TEXT,
  manufacturer TEXT,
  hazard TEXT,
  hazard_original TEXT,
  risk_level TEXT,
  corrective_action TEXT,
  country TEXT,
  published_date TEXT,
  source_url TEXT,
  image_urls TEXT NOT NULL DEFAULT '[]',
  korea_relevance INTEGER,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_type, source_code, external_id)
);

CREATE INDEX IF NOT EXISTS idx_recalls_source ON recalls (source_type, source_code);
CREATE INDEX IF NOT EXISTS idx_recalls_published ON recalls (published_date);
CREATE INDEX IF NOT EXISTS idx_recalls_brand ON recalls (brand);

CREATE VIRTUAL TABLE IF NOT EXISTS recalls_fts USING fts5(
  id UNINDEXED, title, title_original, brand, model, manufacturer, hazard,
  content='recalls', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS recalls_ai AFTER INSERT ON recalls BEGIN
  INSERT INTO recalls_fts(rowid, id, title, title_original, brand, model, manufacturer, hazard)
  VALUES (new.rowid, new.id, new.title, new.title_original, new.brand, new.model, new.manufacturer, new.hazard);
END;

CREATE TRIGGER IF NOT EXISTS recalls_ad AFTER DELETE ON recalls BEGIN
  INSERT INTO recalls_fts(recalls_fts, rowid, id, title, title_original, brand, model, manufacturer, hazard)
  VALUES ('delete', old.rowid, old.id, old.title, old.title_original, old.brand, old.model, old.manufacturer, old.hazard);
END;

CREATE TRIGGER IF NOT EXISTS recalls_au AFTER UPDATE ON recalls BEGIN
  INSERT INTO recalls_fts(recalls_fts, rowid, id, title, title_original, brand, model, manufacturer, hazard)
  VALUES ('delete', old.rowid, old.id, old.title, old.title_original, old.brand, old.model, old.manufacturer, old.hazard);
  INSERT INTO recalls_fts(rowid, id, title, title_original, brand, model, manufacturer, hazard)
  VALUES (new.rowid, new.id, new.title, new.title_original, new.brand, new.model, new.manufacturer, new.hazard);
END;

CREATE TABLE IF NOT EXISTS match_requests (
  id TEXT PRIMARY KEY,
  image_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  note TEXT,
  analysis_json TEXT,
  candidates_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`);

const upsertStmt = db.prepare(`
INSERT INTO recalls (
  id, source_type, source_code, external_id, title, title_original, brand, model,
  manufacturer, hazard, hazard_original, risk_level, corrective_action, country,
  published_date, source_url, image_urls, korea_relevance, raw_json, updated_at
) VALUES (
  @id, @source_type, @source_code, @external_id, @title, @title_original, @brand, @model,
  @manufacturer, @hazard, @hazard_original, @risk_level, @corrective_action, @country,
  @published_date, @source_url, @image_urls, @korea_relevance, @raw_json, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT (id) DO UPDATE SET
  title = excluded.title,
  title_original = excluded.title_original,
  brand = excluded.brand,
  model = excluded.model,
  manufacturer = excluded.manufacturer,
  hazard = excluded.hazard,
  hazard_original = excluded.hazard_original,
  risk_level = excluded.risk_level,
  corrective_action = excluded.corrective_action,
  country = excluded.country,
  published_date = excluded.published_date,
  source_url = excluded.source_url,
  image_urls = excluded.image_urls,
  korea_relevance = excluded.korea_relevance,
  raw_json = excluded.raw_json,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);

export function upsertRecall(recall: NormalizedRecall): void {
  upsertStmt.run({
    ...recall,
    korea_relevance: recall.korea_relevance === null ? null : recall.korea_relevance ? 1 : 0,
    image_urls: JSON.stringify(recall.image_urls),
    raw_json: JSON.stringify(recall.raw),
  });
}

export function upsertRecalls(recalls: NormalizedRecall[]): { inserted: number } {
  const tx = db.transaction((items: NormalizedRecall[]) => {
    for (const item of items) upsertRecall(item);
  });
  tx(recalls);
  return { inserted: recalls.length };
}

export function rowToRecall(row: RecallRow) {
  return {
    ...row,
    image_urls: JSON.parse(row.image_urls ?? "[]"),
    raw: JSON.parse(row.raw_json ?? "null"),
    korea_relevance: row.korea_relevance === null ? null : Boolean(row.korea_relevance),
  };
}

export function matchRequestRowToJson(row: MatchRequestRow) {
  return {
    ...row,
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    candidates: row.candidates_json ? JSON.parse(row.candidates_json) : [],
  };
}

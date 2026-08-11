import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db, matchRequestRowToJson } from "../db";

export const matchRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("only image uploads are allowed"));
    }
    cb(null, true);
  },
});

const insertStmt = db.prepare(`
  INSERT INTO match_requests (id, image_path, status, note)
  VALUES (@id, @image_path, 'pending', @note)
`);

const updateStmt = db.prepare(`
  UPDATE match_requests
  SET status = @status,
      analysis_json = @analysis_json,
      candidates_json = @candidates_json,
      note = COALESCE(@note, note),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`);

// Create a new match request by uploading a product photo. A Claude
// session (interactive, or a Routine watching pending requests) then
// analyzes the image, calls mcp__MCP__match_recall_by_image_features for
// domestic candidates and text search on the overseas MCP for candidates,
// and reports results back via PATCH /:id. See docs/INGESTION.md.
matchRouter.post("/", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "photo file is required (field name 'photo')" });

  const id = randomUUID();
  insertStmt.run({
    id,
    image_path: path.relative(process.cwd(), req.file.path),
    note: typeof req.body?.note === "string" ? req.body.note : null,
  });

  res.status(201).json({ id, status: "pending" });
});

matchRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM match_requests ORDER BY created_at DESC LIMIT 50`)
    .all() as import("../types").MatchRequestRow[];
  res.json({ data: rows.map(matchRequestRowToJson) });
});

matchRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM match_requests WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(matchRequestRowToJson(row as any));
});

matchRouter.patch("/:id", (req, res) => {
  const existing = db.prepare(`SELECT * FROM match_requests WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const { status, analysis, candidates, note } = req.body ?? {};
  if (status && !["pending", "completed", "failed"].includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }

  updateStmt.run({
    id: req.params.id,
    status: status ?? (existing as any).status,
    analysis_json: analysis !== undefined ? JSON.stringify(analysis) : (existing as any).analysis_json,
    candidates_json: candidates !== undefined ? JSON.stringify(candidates) : (existing as any).candidates_json,
    note: note ?? null,
  });

  const updated = db.prepare(`SELECT * FROM match_requests WHERE id = ?`).get(req.params.id);
  res.json(matchRequestRowToJson(updated as any));
});

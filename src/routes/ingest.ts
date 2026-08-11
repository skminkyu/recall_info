import { Router } from "express";
import { upsertRecalls } from "../db";
import { normalizeAndValidate } from "./recalls";

export const ingestRouter = Router();

/**
 * Ingests raw records fetched from the domestic or overseas recall MCP
 * connectors. Body: { source_type: "domestic" | "overseas", raw: object[] }
 *
 * Intended caller: a Claude session (interactive or a scheduled Routine)
 * that has called the MCP tools (mcp__MCP__list_recent_recalls /
 * mcp__MCP__search for domestic, mcp__MCP-c805d72e__search_recalls /
 * find_recalls_by_model for overseas) and forwards the raw results here
 * for normalization + storage. See docs/INGESTION.md.
 */
ingestRouter.post("/", (req, res) => {
  const { source_type, raw } = req.body ?? {};
  if (source_type !== "domestic" && source_type !== "overseas") {
    return res.status(400).json({ error: "source_type must be 'domestic' or 'overseas'" });
  }
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: "raw must be an array of MCP result objects" });
  }

  try {
    const normalized = normalizeAndValidate(source_type, raw);
    const result = upsertRecalls(normalized);
    res.json({ ok: true, ingested: result.inserted });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "ingest_failed" });
  }
});

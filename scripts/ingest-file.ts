/**
 * CLI ingestion helper.
 *
 * Usage:
 *   npm run ingest -- <file.json> [domestic|overseas]
 *
 * <file.json> is either:
 *   - { "source_type": "domestic" | "overseas", "raw": [ ...MCP result items... ] }
 *   - a bare array of MCP result items (then the second CLI arg is required)
 *
 * The raw items are exactly what the recall MCP tools return, e.g. the
 * `data` array from mcp__MCP__list_recent_recalls / mcp__MCP__search
 * (domestic, SafetyKorea) or mcp__MCP-c805d72e__search_recalls /
 * find_recalls_by_model (overseas, 13 government sources). See
 * docs/INGESTION.md for the end-to-end workflow.
 */
import fs from "node:fs";
import path from "node:path";
import { upsertRecalls } from "../src/db";
import { normalize } from "../src/normalize";
import { SourceType } from "../src/types";

function main() {
  const [, , filePath, sourceTypeArg] = process.argv;
  if (!filePath) {
    console.error("Usage: npm run ingest -- <file.json> [domestic|overseas]");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf-8"));

  let sourceType: SourceType | undefined = sourceTypeArg as SourceType | undefined;
  let rawItems: unknown[];

  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else {
    rawItems = parsed.raw ?? parsed.data ?? [];
    sourceType = sourceType ?? parsed.source_type;
  }

  if (sourceType !== "domestic" && sourceType !== "overseas") {
    console.error("source_type must be 'domestic' or 'overseas' (pass as 2nd arg or in the JSON file)");
    process.exit(1);
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    console.error("No records found to ingest.");
    process.exit(1);
  }

  const normalized = rawItems.map((item) => normalize(sourceType as SourceType, item));
  const result = upsertRecalls(normalized);
  console.log(`Ingested ${result.inserted} ${sourceType} records from ${resolved}`);
}

main();

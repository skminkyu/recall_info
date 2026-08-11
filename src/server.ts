import express from "express";
import path from "node:path";
import { recallsRouter } from "./routes/recalls";
import { ingestRouter } from "./routes/ingest";
import { matchRouter } from "./routes/match";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.resolve(__dirname, "..", "data", "uploads")));
app.use(express.static(path.resolve(__dirname, "..", "public")));

app.use("/api/recalls", recallsRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/match-requests", matchRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "internal_error" });
});

app.listen(PORT, () => {
  console.log(`recall_info server listening on http://localhost:${PORT}`);
});

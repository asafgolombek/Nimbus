import { Database } from "bun:sqlite";
import { buildItemListSql } from "../packages/gateway/src/index/item-list-query.ts";
import { LocalIndex } from "../packages/gateway/src/index/local-index.ts";

// Minimal benchmark script to output metrics for GitHub Action Benchmark
const ROWS = 10000;
const RUNS = 50;

async function run() {
  const db = new Database(":memory:");
  LocalIndex.ensureSchema(db);
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO item (id, service, type, external_id, title, body_preview, url, modified_at, synced_at, pinned)
     VALUES (?, 'github', 'pr', ?, 't', '', '', ?, ?, 0)`,
  );
  db.run("BEGIN");
  for (let i = 0; i < ROWS; i++) {
    ins.run(`gh:${String(i)}`, String(i), now, now);
  }
  db.run("COMMIT");

  const { sql, vals } = buildItemListSql({
    services: ["github"],
    types: ["pr"],
    sinceMs: now - 86400000,
    limit: 50,
  });

  const samples: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    db.query(sql).all(...vals);
    samples.push(performance.now() - t0);
  }

  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

  const results = [
    {
      name: "Structured Item Query Latency",
      unit: "ms",
      value: avg,
    },
  ];

  console.log(JSON.stringify(results, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

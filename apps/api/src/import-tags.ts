// 태그 가져오기: node apps/api/src/import-tags.ts <danbooru-tags.csv> [--force]
// 다시 돌려도 된다. 파일 SHA-256이 마지막 가져오기와 같으면 건너뛴다(--force로 강제). DESIGN 6절 "태그 가져오기".

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createDb } from "./db/connect.ts";
import { migrateToLatest } from "./db/migrations.ts";
import { importTags } from "./services/tags.ts";

const url = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const force = args.includes("--force");
const file = args.find((a) => a !== "--force");
if (!url || !file) {
  console.error("usage: DATABASE_URL=… node apps/api/src/import-tags.ts <csv> [--force]");
  process.exit(1);
}
const db = createDb(url, { max: 2 });
try {
  await migrateToLatest(db);
  const t = performance.now();
  const r = await importTags(db, { fileName: basename(file), bytes: readFileSync(file), force });
  if (r.skipped) console.log(`skipped: same data version ${r.sha256.slice(0, 12)} (${r.rows} rows). --force to import again`);
  else {
    console.log(`imported ${r.rows} tags from ${basename(file)} (sha256 ${r.sha256.slice(0, 12)}) in ${((performance.now() - t) / 1000).toFixed(1)}s`);
    console.log(`columns: ${r.columns.join(", ")}${r.unknownColumns.length > 0 ? ` (ignored: ${r.unknownColumns.join(", ")})` : ""}`);
    console.log(`stats: ${JSON.stringify(r.stats)}`);
  }
} finally {
  await db.destroy();
}

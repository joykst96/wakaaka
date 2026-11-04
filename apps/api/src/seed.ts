// 시드 넣기: node apps/api/src/seed.ts [examples.json] [소유자 아이디]
// 먼저 node fixtures/tools/build-examples.ts로 예시를 만든다. 빈 DB(test-reset.sh 뒤)에 넣는 것이 전제다.

import { readFileSync } from "node:fs";
import { createDb } from "./db/connect.ts";
import { migrateToLatest } from "./db/migrations.ts";
import { seedExamples } from "./services/seed.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const file = process.argv[2] ?? new URL("../../../fixtures/out/examples.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = createDb(url, { max: 2 });
try {
  await migrateToLatest(db);
  const names = await seedExamples(db, JSON.parse(readFileSync(file, "utf8")), process.argv[3]);
  for (const [name, id] of names) console.log(`${id}  ${name}`);
  console.log(`seeded ${names.size} wildcards`);
} finally {
  await db.destroy();
}

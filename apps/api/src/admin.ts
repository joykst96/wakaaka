// 관리 CLI 진입점 (DESIGN 9절 "관리"). 서버에서만 돌린다. 웹·API에는 관리 권한이 없다.
//   docker compose -p wakaaka exec -T app node apps/api/src/admin.ts <command> [args] [--yes]
//   이 PC에서는 deploy/prod-admin.sh <command> [args] [--yes]
// 명령 목록은 admincli.ts의 USAGE. 바꾸는 명령은 --yes가 없으면 드라이런이다.

import { runAdmin } from "./admincli.ts";
import { createDb } from "./db/connect.ts";
import { migrateToLatest } from "./db/migrations.ts";
import { AdminError } from "./services/admin.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(url, { max: 2 });
let code = 0;
try {
  await migrateToLatest(db);
  await runAdmin(db, process.argv.slice(2), (line) => console.log(line));
} catch (e) {
  if (!(e instanceof AdminError)) throw e;
  console.error(e.message);
  code = 1;
} finally {
  await db.destroy();
}
process.exit(code);

// 서버 진입점: node apps/api/src/server.ts
// 환경 변수: DATABASE_URL(필수), PORT(기본 3000), HOST(기본 0.0.0.0), WEB_DIST(빌드된 웹 폴더, 없으면 API만),
//   RATE_LIMIT(off면 앱 속도 제한을 끈다, 기본 켬), TRUST_CF_IP(1이면 CF-Connecting-IP를 IP로 쓴다, DESIGN 9절). 예시는 apps/api/.env.example.

import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createDb } from "./db/connect.ts";
import { migrateToLatest } from "./db/migrations.ts";
import { DEFAULT_LIMITS } from "./ratelimit.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(url);
await migrateToLatest(db);

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";
const webDir = process.env.WEB_DIST || undefined;
const rateLimit = process.env.RATE_LIMIT === "off" ? undefined : { ...DEFAULT_LIMITS, trustCfIp: process.env.TRUST_CF_IP === "1" };
const server = serve({ fetch: createApp({ db, webDir, rateLimit }).fetch, port, hostname }, (info) => console.log(`wakaaka api listening on ${hostname}:${info.port}${webDir ? ` (web: ${webDir})` : ""}${rateLimit ? ` (rate limit on${rateLimit.trustCfIp ? ", CF-Connecting-IP" : ""})` : " (rate limit off)"}`));

const stop = () => server.close(() => void db.destroy().then(() => process.exit(0)));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

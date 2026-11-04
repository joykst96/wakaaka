// 통합 테스트 도우미. 테스트마다 스키마를 새로 만들고 마이그레이션한 뒤 앱을 붙인다(DESIGN 12절).
// 스키마는 global-setup.ts가 전체 테스트가 끝난 뒤 지운다.
// DB: TEST_DATABASE_URL (기본은 npm run db:up이 띄우는 127.0.0.1:54329의 tmpfs Postgres).

import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { createApp, SESSION_COOKIE } from "../src/app.ts";
import { createDb, type Db } from "../src/db/connect.ts";
import { migrateToLatest } from "../src/db/migrations.ts";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://wakaaka:wakaaka@127.0.0.1:54329/wakaaka_test";

export interface TestEnv {
  db: Db;
  app: ReturnType<typeof createApp>;
  schema: string;
  close(): Promise<void>;
}

export async function setupEnv(): Promise<TestEnv> {
  const schema = "t_" + randomBytes(6).toString("hex");
  const admin = createDb(TEST_DATABASE_URL, { max: 1 });
  await sql`create schema ${sql.id(schema)}`.execute(admin);
  await admin.destroy();
  const db = createDb(TEST_DATABASE_URL, { searchPath: schema, max: 4 });
  await migrateToLatest(db, schema);
  return {
    db,
    app: createApp({ db }),
    schema,
    async close() {
      await db.destroy();
    },
  };
}

export interface Res {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

/** 쿠키를 들고 다니는 간단한 클라이언트 */
export class Client {
  cookie: string | null = null;
  readonly env: TestEnv;
  constructor(env: TestEnv) {
    this.env = env;
  }

  async request(method: string, path: string, body?: unknown, init: { raw?: string; contentType?: string; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...init.headers };
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
    let payload: string | undefined;
    if (init.raw !== undefined) payload = init.raw;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) headers["content-type"] = init.contentType ?? "application/json";
    const res = await this.env.app.request(path, { method, headers, body: payload });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie?.startsWith(SESSION_COOKIE + "=")) {
      const v = setCookie.slice(SESSION_COOKIE.length + 1).split(";")[0]!;
      this.cookie = v === "" ? null : v;
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: res.status, body: parsed, text, headers: res.headers };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body);
  put = (path: string, body?: unknown) => this.request("PUT", path, body);
  del = (path: string) => this.request("DELETE", path);

  async signup(username: string, password = "password123"): Promise<this> {
    const r = await this.post("/api/auth/signup", { username, password });
    if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.text}`);
    return this;
  }

  /** 문서를 만들고 ID를 돌려준다. 실패하면 던진다 */
  async create(doc: unknown, categories?: number[]): Promise<string> {
    const r = await this.post("/api/wildcards", categories ? { doc, categories } : { doc });
    if (r.status !== 201) throw new Error(`create failed: ${r.status} ${r.text}`);
    return r.body.id as string;
  }
}

export const W = (id: string) => "${w:" + id + "}";

/** 간단한 문서 */
export function doc(name: string, items: unknown[], extra: Record<string, unknown> = {}) {
  return { schema: 1, name, items, ...extra };
}

// Hono 앱. routes/(입력 검증) → services/(로직) → repositories/(SQL).

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { BASE62_12 } from "@wakaaka/core";
import { canonicalize } from "@wakaaka/core/hash";
import { sql } from "kysely";
import { z } from "zod";
import type { Db } from "./db/connect.ts";
import { ApiError, errorBody, json, readJson } from "./http.ts";
import * as auth from "./services/auth.ts";
import * as bundles from "./services/bundle.ts";
import * as folders from "./services/folders.ts";
import * as social from "./services/social.ts";
import { MAX_DOC_BYTES } from "./services/validate.ts";
import { rateLimit, type RateLimitConfig } from "./ratelimit.ts";
import { serveWeb } from "./static.ts";
import * as tags from "./services/tags.ts";
import * as wc from "./services/wildcards.ts";

export const SESSION_COOKIE = "wk_session";

type Env = { Variables: { owner: wc.Owner | null } };

export interface AppDeps {
  db: Db;
  /** 빌드된 웹(apps/web/dist). 주면 /api 밖의 GET을 정적 파일과 SPA index.html로 답한다 */
  webDir?: string;
  /** 앱 안의 속도 제한(DESIGN 9절). 주지 않으면 끈다(통합 테스트). server.ts는 기본으로 켠다 */
  rateLimit?: RateLimitConfig;
}

const authBody = z.strictObject({ username: z.string(), password: z.string() });
const passwordBody = z.strictObject({ current: z.string(), next: z.string() });
const VERSION = /^[1-9][0-9]{0,8}$/;

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String), message: i.message }));
    throw new ApiError(400, "E_SCHEMA", "request body does not match the schema", { issues });
  }
  return r.data;
}

/** 경로의 ID는 base62 12자만 받는다. 아니면 없는 것과 같다 */
function idParam(c: Context): string {
  const id = c.req.param("id") ?? "";
  if (!BASE62_12.test(id)) throw new ApiError(404, "E_NOT_FOUND", "wildcard not found");
  return id;
}

function requireOwner(c: Context<Env>): wc.Owner {
  const o = c.get("owner");
  if (!o) throw new ApiError(401, "E_AUTH", "login required");
  return o;
}

const limit = (maxSize: number) =>
  bodyLimit({ maxSize, onError: (c) => json(c, errorBody(new ApiError(413, "E_TOO_LARGE", "request body is too large")), 413) });

export function createApp({ db, webDir, rateLimit: limits }: AppDeps) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
  });
  app.onError((e, c) => {
    if (e instanceof ApiError) return json(c, errorBody(e), e.status);
    console.error(e);
    return json(c, { error: { code: "E_INTERNAL", message: "internal error" } }, 500);
  });
  app.notFound((c) => json(c, { error: { code: "E_NOT_FOUND", message: "not found" } }, 404));

  // compose healthcheck용. DB까지 닿는지 본다
  app.get("/health", async (c) => {
    await sql`select 1`.execute(db);
    return json(c, { ok: true });
  });

  app.use("/api/*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const o = token ? await auth.sessionOwner(db, token) : undefined;
    c.set("owner", o ? { id: o.id, username: o.username } : null);
    await next();
  });
  if (limits) app.use("/api/*", rateLimit(limits, (c) => (c.get("owner") as wc.Owner | null)?.id ?? null));
  app.use("/api/auth/*", limit(4 * 1024));
  // 문서 256KB + 요청 껍데기({"doc":…,"categories":[…]}) 여유. 문서 자체의 크기는 정규화한 뒤 다시 잰다
  app.use("/api/wildcards/*", limit(MAX_DOC_BYTES + 4 * 1024));
  app.use("/api/wildcards", limit(MAX_DOC_BYTES + 4 * 1024));
  app.use("/api/favorites", limit(4 * 1024));
  app.use("/api/favorites/*", limit(4 * 1024));
  app.use("/api/folders", limit(4 * 1024));
  // 옮기기: ID 500개(약 8KB)
  app.use("/api/folders/*", limit(16 * 1024));
  app.use("/api/lookup", limit(16 * 1024));
  app.use("/api/tags/lookup", limit(64 * 1024));

  // ------------------------------------------------------------ 계정

  const startSession = (c: Context, token: string) =>
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: auth.SESSION_DAYS * 86400 });

  app.post("/api/auth/signup", async (c) => {
    const b = parseBody(authBody, await readJson(c));
    const { owner, token } = await auth.signup(db, b.username, b.password);
    startSession(c, token);
    return json(c, { username: owner.username }, 201);
  });
  app.post("/api/auth/login", async (c) => {
    const b = parseBody(authBody, await readJson(c));
    const { owner, token } = await auth.login(db, b.username, b.password);
    startSession(c, token);
    return json(c, { username: owner.username });
  });
  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.logout(db, token);
    deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    return json(c, { ok: true });
  });
  app.post("/api/auth/password", async (c) => {
    const o = requireOwner(c);
    const b = parseBody(passwordBody, await readJson(c));
    await auth.changePassword(db, o.id, getCookie(c, SESSION_COOKIE)!, b.current, b.next);
    return json(c, { ok: true });
  });
  app.get("/api/me", (c) => {
    const o = requireOwner(c);
    return json(c, { username: o.username });
  });

  // ------------------------------------------------------------ 와일드카드

  app.get("/api/wildcards", async (c) => json(c, { wildcards: await wc.listMine(db, requireOwner(c)) }));
  app.post("/api/wildcards", async (c) => {
    const owner = requireOwner(c);
    const body = parseBody(wc.saveBodySchema, await readJson(c));
    return json(c, await wc.createWildcard(db, owner, body), 201);
  });
  app.put("/api/wildcards/:id", async (c) => {
    const owner = requireOwner(c);
    const id = idParam(c);
    const body = parseBody(wc.saveBodySchema, await readJson(c));
    return json(c, await wc.saveVersion(db, owner, id, body));
  });
  app.delete("/api/wildcards/:id", async (c) => {
    const owner = requireOwner(c);
    await wc.deleteWildcard(db, owner, idParam(c));
    return json(c, { ok: true });
  });
  app.get("/api/wildcards/:id", async (c) => {
    const id = idParam(c);
    const v = c.req.query("v");
    if (v !== undefined && !VERSION.test(v)) throw new ApiError(400, "E_VERSION", "v must be a version number");
    const w = await wc.getWildcard(db, id, v === undefined ? undefined : Number(v));
    return json(c, { ...w, viewer: await social.viewerFlags(db, c.get("owner"), id) });
  });
  app.get("/api/wildcards/:id/versions", async (c) => json(c, { versions: await wc.listVersions(db, idParam(c)) }));
  app.get("/api/wildcards/:id/dependents", async (c) => json(c, { dependents: await wc.listDependents(db, idParam(c)) }));
  app.post("/api/wildcards/:id/import", async (c) => {
    const owner = requireOwner(c);
    const dry = c.req.query("dryRun");
    if (dry !== undefined && dry !== "1" && dry !== "0") throw new ApiError(400, "E_SCHEMA", "dryRun must be 0 or 1");
    return json(c, await wc.importWildcard(db, owner, idParam(c), dry === "1"), dry === "1" ? 200 : 201);
  });

  app.put("/api/wildcards/:id/like", async (c) => json(c, await social.setLike(db, requireOwner(c), idParam(c), true)));
  app.delete("/api/wildcards/:id/like", async (c) => json(c, await social.setLike(db, requireOwner(c), idParam(c), false)));

  // ------------------------------------------------------------ 폴더 (나만 보는 정리용, DESIGN 11절 "폴더")

  app.get("/api/folders", async (c) => json(c, await folders.listFolders(db, requireOwner(c))));
  app.post("/api/folders", async (c) => {
    const owner = requireOwner(c);
    const b = parseBody(folders.folderBodySchema, await readJson(c));
    return json(c, await folders.createFolder(db, owner, b.name), 201);
  });
  // /api/folders/{id}보다 먼저 둔다(폴더 ID는 12자라 겹치지 않지만 읽는 사람을 위해)
  app.post("/api/folders/move", async (c) => {
    const owner = requireOwner(c);
    const b = parseBody(folders.moveBodySchema, await readJson(c));
    return json(c, await folders.moveWildcards(db, owner, b.folder, b.wildcards));
  });
  app.put("/api/folders/:id", async (c) => {
    const owner = requireOwner(c);
    const b = parseBody(folders.folderBodySchema, await readJson(c));
    return json(c, await folders.renameFolder(db, owner, c.req.param("id"), b.name));
  });
  app.delete("/api/folders/:id", async (c) => json(c, await folders.deleteFolder(db, requireOwner(c), c.req.param("id"))));

  // ------------------------------------------------------------ 즐겨찾기, 둘러보기, 조회

  app.get("/api/favorites", async (c) => json(c, await social.listFavorites(db, requireOwner(c))));
  app.post("/api/favorites", async (c) => {
    const owner = requireOwner(c);
    const b = parseBody(social.favoriteBodySchema, await readJson(c));
    const r = await social.addFavorite(db, owner, b.wildcard);
    return json(c, r, r.added ? 201 : 200);
  });
  app.delete("/api/favorites/:id", async (c) => json(c, await social.removeFavorite(db, requireOwner(c), idParam(c))));
  app.get("/api/explore", async (c) => json(c, await social.explore(db, c.get("owner"), c.req.query())));
  app.post("/api/lookup", async (c) => {
    const b = parseBody(social.lookupBodySchema, await readJson(c));
    return json(c, await social.lookup(db, c.get("owner"), b.ids));
  });
  app.get("/api/users/:username/wildcards", async (c) => json(c, await social.userWildcards(db, c.get("owner"), c.req.param("username"))));

  // ------------------------------------------------------------ 태그 (로그인 없이)

  app.get("/api/tags/suggest", async (c) => {
    const r = await tags.suggest(db, c.req.query());
    // 태그 데이터는 가져오기 때만 바뀐다(DESIGN 7절 "태그 자동완성")
    c.header("Cache-Control", "public, max-age=300");
    return json(c, r);
  });
  app.post("/api/tags/lookup", async (c) => {
    const b = parseBody(tags.lookupBodySchema, await readJson(c));
    return json(c, await tags.lookup(db, b.names));
  });

  // ------------------------------------------------------------ 노드용 (로그인 없이)

  app.get("/api/w/:id/bundle", async (c) => {
    const { bundle } = await bundles.latestBundle(db, idParam(c));
    // 노드가 해시를 다시 계산하므로 정규화 그대로 보낸다. 같은 묶음이면 응답 바이트도 같다
    return c.body(canonicalize(bundle), 200, { "Content-Type": "application/json; charset=utf-8" });
  });
  app.get("/api/w/:id/resolve", async (c) => {
    const lock = c.req.query("lock");
    const r = await bundles.resolve(db, idParam(c), c.req.query("seed"), lock);
    // lock이 있으면 결과가 고정이라 캐시해도 된다(DESIGN 7절). 지우면 404가 되어야 하므로 짧게 둔다
    if (lock !== undefined) c.header("Cache-Control", "public, max-age=300");
    return json(c, r);
  });
  app.get("/api/w/:id/export", async (c) => json(c, await bundles.exportPrompt(db, idParam(c), c.req.query())));
  app.get("/api/w/:id/meta", async (c) => {
    const w = await bundles.liveRoot(db, idParam(c));
    return json(c, { id: w.id, name: w.name, owner: w.owner, version: w.latest_seq, hash: w.hash });
  });

  // ------------------------------------------------------------ 웹 (정적 파일, SPA)

  if (webDir !== undefined) {
    const web = serveWeb(webDir);
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") || c.req.path === "/api" ? next() : web(c)));
  }

  return app;
}

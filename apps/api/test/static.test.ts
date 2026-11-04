// 빌드된 웹 서빙 (DESIGN 9절 7항 CSP, 10절 배포). DB 없이 임시 폴더로 본다.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Db } from "../src/db/connect.ts";
import { CSP, safePath } from "../src/static.ts";

const dir = mkdtempSync(join(tmpdir(), "wakaaka-web-"));
mkdirSync(join(dir, "assets"));
writeFileSync(join(dir, "index.html"), "<!doctype html><title>wakaaka</title>");
writeFileSync(join(dir, "assets", "index-abc.js"), "console.log(1)");
writeFileSync(join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");
// 웹 폴더 밖의 파일 (빠져나가면 안 된다)
writeFileSync(join(dir, "..", "wakaaka-secret.txt"), "secret");
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(dir, "..", "wakaaka-secret.txt"), { force: true });
});

// /api 경로를 타지 않는 요청만 보내므로 DB는 쓰이지 않는다(세션 미들웨어는 /api/*에만 있다)
const app = createApp({ db: {} as Db, webDir: dir });
const get = (path: string, method = "GET") => app.request(path, { method });

describe("웹 서빙", () => {
  it("/ 와 SPA 경로는 index.html, CSP·noindex·no-cache", async () => {
    for (const p of ["/", "/w/abcdefghijkl", "/u/sample", "/new", "/settings"]) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(r.headers.get("content-security-policy")).toBe(CSP);
      expect(CSP.startsWith("default-src 'self'")).toBe(true);
      expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("no-cache");
      expect(await r.text()).toContain("<title>wakaaka</title>");
    }
  });

  it("해시가 든 assets는 오래 캐시, 형식은 확장자로", async () => {
    const r = await get("/assets/index-abc.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await r.text()).toBe("console.log(1)");
    expect((await get("/robots.txt")).headers.get("cache-control")).toBe("no-cache");
  });

  it("확장자가 있는데 없는 파일은 404 (index.html로 바꾸지 않는다)", async () => {
    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/favicon.ico")).status).toBe(404);
  });

  it("/api의 없는 경로는 JSON 404 그대로", async () => {
    const r = await get("/api/nope");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("E_NOT_FOUND");
  });

  it("웹 폴더 밖으로 나갈 수 없다", async () => {
    for (const p of ["/../wakaaka-secret.txt", "/%2e%2e/wakaaka-secret.txt", "/assets/..%2f..%2fwakaaka-secret.txt", "/..%5cwakaaka-secret.txt", "/%00", "/%E0%A4%A"]) {
      const r = await get(p);
      expect(await r.text(), p).not.toContain("secret");
    }
    expect(safePath(dir, "/../wakaaka-secret.txt")).toBeNull();
    expect(safePath(dir, "/%2e%2e/wakaaka-secret.txt")).toBeNull();
    expect(safePath(dir, "/a\\..\\..\\x")).toBeNull();
    expect(safePath(dir, "/assets/index-abc.js")).toBe(join(dir, "assets", "index-abc.js"));
  });

  it("webDir가 없으면 API만 (웹 경로는 JSON 404)", async () => {
    const apiOnly = createApp({ db: {} as Db });
    const r = await apiOnly.request("/w/abcdefghijkl");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

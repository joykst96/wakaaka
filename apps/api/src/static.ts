// 빌드된 웹(apps/web/dist) 서빙 (DESIGN 10절 배포: app 하나가 API와 정적 웹을 같이 낸다).
// /api와 /health는 여기 오지 않는다. 파일이 있으면 그 파일, 확장자 없는 경로는 index.html(SPA), 확장자가 있는데 없으면 404.
// HTML에는 CSP default-src 'self'(DESIGN 9절 7항)와 noindex(9절 노출)를 붙인다.

import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Context } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** default-src 'self'는 요청한 정책 그대로. 나머지는 default-src가 덮지 않는 지시어라 더했다(NOTES Phase 3) */
export const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

export function webHeaders(c: Context): void {
  c.header("Content-Security-Policy", CSP);
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Referrer-Policy", "same-origin");
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** URL 경로 → webDir 안의 파일 경로. 밖으로 나가거나 이상한 글자가 있으면 null */
export function safePath(webDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const root = resolve(webDir);
  const full = resolve(join(root, decoded));
  return full === root || full.startsWith(root + sep) ? full : null;
}

export function serveWeb(webDir: string) {
  const index = join(resolve(webDir), "index.html");
  return async (c: Context) => {
    const path = c.req.path;
    const file = safePath(webDir, path);
    if (file && file !== resolve(webDir) && (await isFile(file))) {
      const body = await readFile(file);
      const immutable = path.startsWith("/assets/");
      // 빌드 산출물 이름에 해시가 들어 있어 내용이 바뀌면 이름이 바뀐다
      c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      if (extname(file) === ".html") webHeaders(c);
      return c.body(body, 200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    }
    if (extname(path) !== "") return c.text("not found", 404);
    webHeaders(c);
    c.header("Cache-Control", "no-cache");
    return c.body(await readFile(index), 200, { "Content-Type": TYPES[".html"]! });
  };
}

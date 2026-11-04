// 앱 안의 속도 제한 (DESIGN 9절 "속도 제한", 사용자 결정 2026-11-04).
// Cloudflare Free 플랜은 경로로만 규칙을 걸 수 있어 쓰기(같은 경로의 PUT·DELETE)를 따로 셀 수 없다. 그래서 앱에서 센다.
// 메모리에 둔다(프로세스 하나). 재시작하면 비워진다. 버킷: max개까지 한 번에 쓰고 windowMs 동안 max개가 다시 찬다.

import type { Context, MiddlewareHandler } from "hono";
import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ApiError, errorBody, json } from "./http.ts";

export interface Limit {
  max: number;
  windowMs: number;
}

export interface RateLimitConfig {
  writeAccount: Limit;
  writeIp: Limit;
  signupIp: Limit;
  loginIp: Limit;
  /** true면 CF-Connecting-IP를 믿는다. 운영은 앱이 127.0.0.1에만 열려 터널로만 들어온다(DESIGN 9절) */
  trustCfIp: boolean;
  /** 테스트용 시계 */
  now?: () => number;
}

export const DEFAULT_LIMITS: Omit<RateLimitConfig, "trustCfIp"> = {
  writeAccount: { max: 60, windowMs: 60_000 },
  writeIp: { max: 120, windowMs: 60_000 },
  signupIp: { max: 5, windowMs: 3_600_000 },
  loginIp: { max: 30, windowMs: 600_000 },
};

/** 읽기인데 본문이 길어 POST로 받는 것(DESIGN 7절). 쓰기로 세지 않는다 */
const READ_POSTS = new Set(["/api/lookup", "/api/tags/lookup"]);
const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export class Buckets {
  private readonly map = new Map<string, { tokens: number; at: number }>();
  private calls = 0;
  /** maxWindowMs: 가장 긴 창. 그보다 오래 안 쓴 버킷은 다 찼으므로 지워도 같다 */
  private readonly now: () => number;
  private readonly maxWindowMs: number;
  constructor(now: () => number, maxWindowMs: number) {
    this.now = now;
    this.maxWindowMs = maxWindowMs;
  }

  /** 하나를 쓴다. 남은 것이 없으면 쓰지 않고 다시 찰 때까지의 초를 돌려준다 */
  take(key: string, limit: Limit): { ok: true } | { ok: false; retryAfter: number } {
    return this.takeAll([[key, limit]]);
  }

  /** 모든 버킷에 남은 것이 있을 때만 하나씩 쓴다. 하나라도 비었으면 아무것도 쓰지 않는다(거부된 요청이 다른 버킷을 깎지 않게) */
  takeAll(checks: ReadonlyArray<readonly [string, Limit]>): { ok: true } | { ok: false; retryAfter: number } {
    const t = this.now();
    if (++this.calls % 1000 === 0) this.prune(t);
    const states = checks.map(([key, limit]) => {
      const b = this.map.get(key);
      return { key, limit, tokens: b ? Math.min(limit.max, b.tokens + ((t - b.at) * limit.max) / limit.windowMs) : limit.max };
    });
    const empty = states.filter((s) => s.tokens < 1);
    if (empty.length > 0) {
      // 다시 찰 때까지: (1 - tokens) × windowMs / max 밀리초. 정수 연산 쪽으로 먼저 올려 부동소수 오차로 1초 늘지 않게
      const waitMs = Math.max(...empty.map((s) => Math.ceil(((1 - s.tokens) * s.limit.windowMs) / s.limit.max)));
      return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    for (const s of states) this.map.set(s.key, { tokens: s.tokens - 1, at: t });
    return { ok: true };
  }

  /** 다 찬 버킷은 없는 것과 같으므로 지운다(메모리가 계속 늘지 않게) */
  private prune(t: number): void {
    for (const [k, b] of this.map) if (t - b.at > this.maxWindowMs) this.map.delete(k);
  }

  get size(): number {
    return this.map.size;
  }
}

/** 요청한 쪽 IP. 헤더는 trustCfIp일 때만, 길이를 제한해 쓴다 */
export function clientIp(c: Context, trustCfIp: boolean): string {
  if (trustCfIp) {
    const h = c.req.header("cf-connecting-ip");
    if (h && h.length <= 64 && isIP(h) !== 0) return h;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // app.request(테스트)에는 소켓이 없다
  }
}

type Kind = "signup" | "login" | "write" | null;

export function classify(method: string, path: string): Kind {
  if (!WRITE_METHODS.has(method) || !path.startsWith("/api/")) return null;
  if (path === "/api/auth/signup") return "signup";
  if (path === "/api/auth/login" || path === "/api/auth/password") return "login";
  if (path === "/api/auth/logout" || READ_POSTS.has(path)) return null;
  return "write";
}

/** 세션을 읽은 뒤(owner가 정해진 뒤)에 건다 */
export function rateLimit(cfg: RateLimitConfig, getOwnerId: (c: Context) => string | null): MiddlewareHandler {
  const maxWindow = Math.max(cfg.writeAccount.windowMs, cfg.writeIp.windowMs, cfg.signupIp.windowMs, cfg.loginIp.windowMs);
  const buckets = new Buckets(cfg.now ?? Date.now, maxWindow);
  return async (c, next) => {
    const kind = classify(c.req.method, c.req.path);
    if (kind !== null) {
      const ip = clientIp(c, cfg.trustCfIp);
      const checks: Array<[string, Limit]> =
        kind === "signup"
          ? [[`signup:${ip}`, cfg.signupIp]]
          : kind === "login"
            ? [[`login:${ip}`, cfg.loginIp]]
            : [[`write-ip:${ip}`, cfg.writeIp]];
      const owner = kind === "write" ? getOwnerId(c) : null;
      if (owner !== null) checks.push([`write-account:${owner}`, cfg.writeAccount]);
      const r = buckets.takeAll(checks);
      if (!r.ok) {
        c.header("Retry-After", String(r.retryAfter));
        return json(c, errorBody(new ApiError(429, "E_RATE_LIMIT", "too many requests", { retryAfter: r.retryAfter })), 429);
      }
    }
    await next();
  };
}

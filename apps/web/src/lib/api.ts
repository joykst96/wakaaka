// API 클라이언트. 같은 출처(/api)만 부른다. 쓰기는 application/json 본문으로 보낸다(API가 다른 형식은 415).

import type { Doc } from "@wakaaka/core";
import type { BundleLike } from "./preview.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "content-type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "E_NETWORK", "서버에 연결할 수 없습니다");
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const e = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
    const { code, message, ...detail } = (e ?? {}) as Record<string, unknown>;
    // 속도 제한(DESIGN 9절): 앱의 429(JSON)와 Cloudflare의 429(HTML) 모두 같은 문구로
    if (res.status === 429) throw new ApiError(429, "E_RATE_LIMIT", rateLimitText(res.headers.get("retry-after")), detail);
    throw new ApiError(res.status, typeof code === "string" ? code : "E_HTTP", typeof message === "string" ? message : res.statusText, detail);
  }
  return parsed as T;
}

/** Retry-After(초)가 있으면 기다릴 시간을 붙인다 */
export function rateLimitText(retryAfter: string | null): string {
  const n = retryAfter !== null && /^[0-9]{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
  return n === null ? "요청이 너무 잦습니다. 잠시 뒤에 다시 해 주세요." : `요청이 너무 잦습니다. ${Math.max(1, n)}초 뒤에 다시 해 주세요.`;
}

const enc = encodeURIComponent;

export interface WildcardMeta {
  id: string;
  name: string;
  owner: string;
  version: number;
  hash: string;
  categories: number[];
  likes: number;
  description: string;
  example: string | null;
  forkedFrom: { wildcard: string; hash: string; owner: string | null } | null;
  createdAt: string;
  updatedAt: string;
}
export type Card = WildcardMeta & { liked: boolean; favorited: boolean };
export type WildcardDetail = WildcardMeta & {
  seq: number;
  seqHash: string;
  seqCreatedAt: string;
  doc: Doc;
  viewer: { liked: boolean; favorited: boolean };
};
export interface Warning {
  code: "W_DEPTH" | "W_BUNDLE_SIZE" | "W_WEIGHT_ZERO";
  wildcard: string;
  depth?: number;
  bytes?: number;
}
export interface SaveResult {
  id: string;
  seq: number;
  hash: string;
  unchanged: boolean;
  warnings: Warning[];
}
export interface ImportResult {
  root: string;
  created: Array<{ id: string; name: string }>;
  reused: Array<{ id: string; name: string }>;
  dryRun: boolean;
}

/** 태그 자동완성 후보 (DESIGN 7절 "태그 자동완성") */
export interface TagSuggestion {
  name: string;
  /** Danbooru 기본 타입 0 general, 1 artist, 3 copyright, 4 character, 5 meta */
  category: number;
  postCount: number;
  body: string;
  keywords: string[];
}

export const api = {
  me: () => call<{ username: string }>("GET", "/api/me"),
  signup: (username: string, password: string) => call<{ username: string }>("POST", "/api/auth/signup", { username, password }),
  login: (username: string, password: string) => call<{ username: string }>("POST", "/api/auth/login", { username, password }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
  changePassword: (current: string, next: string) => call<{ ok: true }>("POST", "/api/auth/password", { current, next }),

  mine: () => call<{ wildcards: WildcardMeta[] }>("GET", "/api/wildcards"),
  get: (id: string, seq?: number) => call<WildcardDetail>("GET", `/api/wildcards/${enc(id)}` + (seq === undefined ? "" : `?v=${seq}`)),
  versions: (id: string) => call<{ versions: Array<{ seq: number; hash: string; createdAt: string }> }>("GET", `/api/wildcards/${enc(id)}/versions`),
  dependents: (id: string) => call<{ dependents: Array<{ id: string; name: string; depth: number }> }>("GET", `/api/wildcards/${enc(id)}/dependents`),
  create: (doc: Doc, categories: number[]) => call<SaveResult>("POST", "/api/wildcards", { doc, categories }),
  save: (id: string, doc: Doc, categories: number[]) => call<SaveResult>("PUT", `/api/wildcards/${enc(id)}`, { doc, categories }),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/api/wildcards/${enc(id)}`),
  importWildcard: (id: string, dryRun: boolean) => call<ImportResult>("POST", `/api/wildcards/${enc(id)}/import` + (dryRun ? "?dryRun=1" : "")),
  like: (id: string, on: boolean) => call<{ liked: boolean; likes: number }>(on ? "PUT" : "DELETE", `/api/wildcards/${enc(id)}/like`),

  favorites: () => call<{ favorites: Card[] }>("GET", "/api/favorites"),
  favorite: (id: string, on: boolean) =>
    on ? call<{ favorited: boolean }>("POST", "/api/favorites", { wildcard: id }) : call<{ favorited: boolean }>("DELETE", `/api/favorites/${enc(id)}`),
  explore: (p: { q?: string; cat?: number[]; sort?: "popular" | "recent"; offset?: number }) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.cat && p.cat.length > 0) qs.set("cat", p.cat.join(","));
    if (p.sort) qs.set("sort", p.sort);
    if (p.offset) qs.set("offset", String(p.offset));
    const s = qs.toString();
    return call<{ wildcards: Card[]; nextOffset: number | null }>("GET", "/api/explore" + (s ? "?" + s : ""));
  },
  lookup: (ids: string[]) => call<{ wildcards: Record<string, Card> }>("POST", "/api/lookup", { ids }),
  user: (username: string) => call<{ user: { username: string }; wildcards: Card[] }>("GET", `/api/users/${enc(username)}/wildcards`),
  bundle: (id: string) => call<BundleLike>("GET", `/api/w/${enc(id)}/bundle`),

  tagSuggest: (q: string) => call<{ tags: TagSuggestion[] }>("GET", `/api/tags/suggest?q=${enc(q)}`),
  tagLookup: (names: string[]) => call<{ tags: Record<string, { category: number; postCount: number }> }>("POST", "/api/tags/lookup", { names }),
};

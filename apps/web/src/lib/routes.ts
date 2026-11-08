// 경로와 링크 (DESIGN 11절 화면 목록, 9절 7항 출력 안전).
// href는 여기서만 만든다. 사용자 문자열을 그대로 넣지 않고, 와일드카드 ID는 base62 12자, 아이디는 계정 규칙으로 검증한 것만 쓴다.

import { BASE62_12 } from "@wakaaka/core";

/** API의 아이디 규칙과 같다(apps/api services/auth.ts USERNAME) */
export const USERNAME = /^[A-Za-z0-9_-]{3,32}$/;

export type Route =
  | { name: "explore" }
  | { name: "wildcard"; id: string }
  | { name: "new" }
  | { name: "user"; username: string }
  | { name: "login" }
  | { name: "signup" }
  | { name: "settings" }
  | { name: "notFound" };

/** 바깥 링크. 주소는 아래 고정 목록에서만 고른다(사용자 문자열 없음). 화면이 아니라서 Route에 넣지 않는다(navigate로 못 간다) */
export type External = { name: "external"; to: keyof typeof EXTERNAL };

/** 바깥 링크 고정 목록: 태그 데이터 출처 표시(DESIGN 6절 "태그 데이터 원천") */
export const EXTERNAL = {
  tagData: "https://huggingface.co/datasets/mengod-hf/danbooru-tags-kr",
  ccBySa4: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
} as const;

export const isWildcardId = (s: string): boolean => BASE62_12.test(s);
export const isUsername = (s: string): boolean => USERNAME.test(s);

/** 경로 → 화면. 형식이 틀린 ID와 아이디는 notFound */
export function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "explore" };
  if (pathname === "/new") return { name: "new" };
  if (pathname === "/login") return { name: "login" };
  if (pathname === "/signup") return { name: "signup" };
  if (pathname === "/settings") return { name: "settings" };
  let m = /^\/w\/([^/]+)$/.exec(pathname);
  if (m) return isWildcardId(m[1]!) ? { name: "wildcard", id: m[1]! } : { name: "notFound" };
  m = /^\/u\/([^/]+)$/.exec(pathname);
  if (m) return isUsername(m[1]!) ? { name: "user", username: m[1]! } : { name: "notFound" };
  return { name: "notFound" };
}

/** 화면 → 경로. 검증에 실패하면 둘러보기로 보낸다(사용자 문자열이 href에 들어가지 않게) */
export function hrefOf(r: Route | External): string {
  switch (r.name) {
    case "explore":
    case "notFound":
      return "/";
    case "wildcard":
      return isWildcardId(r.id) ? `/w/${r.id}` : "/";
    case "user":
      return isUsername(r.username) ? `/u/${r.username}` : "/";
    case "new":
      return "/new";
    case "login":
      return "/login";
    case "signup":
      return "/signup";
    case "settings":
      return "/settings";
    case "external":
      return Object.hasOwn(EXTERNAL, r.to) ? EXTERNAL[r.to] : "/";
  }
}

// 작은 라우터: history API와 popstate. 링크는 Route 객체로만 만든다(routes.ts hrefOf가 검증).
// 앱 안에서 화면을 옮겨도 편집 탭은 내용을 그대로 갖고 있어서(DESIGN 11절 "탭") 이동 전에 묻지 않는다.
// 페이지를 닫거나 새로 고칠 때만, 저장 안 한 탭이 있으면 beforeunload로 묻는다(useLeaveWarning).

import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { hrefOf, parseRoute, type Route } from "../lib/routes.ts";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const href = hrefOf(r);
  if (href === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.scrollTo(0, 0);
  emit();
}

let lastPath = location.pathname;
/** 지금 화면 바로 전의 앱 안 경로(취소하고 돌아갈 곳). 앱에 처음 들어온 화면이면 null */
let previousPath: string | null = null;
window.addEventListener("popstate", () => emit());
listeners.add(() => {
  if (location.pathname !== lastPath) previousPath = lastPath;
  lastPath = location.pathname;
});

/** 바로 전 화면으로(없으면 둘러보기). skip에 해당하는 화면(닫은 탭 등)으로는 돌아가지 않는다 */
export function navigateBack(skip: (r: Route) => boolean = () => false): void {
  const prev = previousPath === null ? null : parseRoute(previousPath);
  navigate(prev && prev.name !== "notFound" && prev.name !== "new" && !skip(prev) ? prev : { name: "explore" });
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => location.pathname,
  );
  return parseRoute(path);
}

export function Link({ to, className, children, title }: { to: Route; className?: string; children: ReactNode; title?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={hrefOf(to)} className={className} onClick={onClick} title={title}>
      {children}
    </a>
  );
}

/** 저장 안 한 내용이 있으면 페이지를 닫거나 새로 고치기 전에 브라우저가 묻게 한다 */
export function useLeaveWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

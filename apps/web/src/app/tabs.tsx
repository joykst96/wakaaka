// 편집 화면 탭 상태 (DESIGN 11절 "탭"): 열린 탭, 저장 안 한 탭, 한 번이라도 띄운 탭(처음 누를 때만 띄운다).
// 와일드카드 화면으로 이동하면 그 탭을 열고, 열린 탭 목록은 이 브라우저에 기억한다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { closeTab, keyOf, loadTabs, moveTab, openTab, replaceTab, routeOf, saveTabs, type TabKey } from "../lib/tabs.ts";
import { navigate, useLeaveWarning, useRoute } from "./router.tsx";

export interface Tabs {
  keys: TabKey[];
  active: TabKey | null;
  dirty: ReadonlySet<TabKey>;
  mounted: ReadonlySet<TabKey>;
  setDirty(key: TabKey, dirty: boolean): void;
  /** 탭 닫기. 저장 안 했으면 묻는다(force면 묻지 않음). 지금 탭이면 옆 탭(없으면 둘러보기)으로 간다. 닫았으면 true */
  close(key: TabKey, opts?: { force?: boolean; navigate?: boolean }): boolean;
  /** 탭 키 바꾸기(새 와일드카드 저장 뒤) */
  replace(from: TabKey, to: TabKey): void;
  move(from: number, to: number): void;
}

const Ctx = createContext<Tabs | null>(null);

const CLOSE_MESSAGE = "저장하지 않은 변경이 있습니다. 내용은 이 브라우저에 임시 보관되어 다시 열면 복구할 수 있습니다. 탭을 닫을까요?";

export function TabsProvider({ children }: { children: ReactNode }) {
  const route = useRoute();
  const active = keyOf(route);
  const [keys, setKeys] = useState<TabKey[]>(() => loadTabs());
  const [dirty, setDirtySet] = useState<ReadonlySet<TabKey>>(new Set());
  const [mounted, setMounted] = useState<ReadonlySet<TabKey>>(new Set());

  // 와일드카드 화면으로 오면 그 탭을 열고 띄운다
  useEffect(() => {
    if (active === null) return;
    setKeys((ks) => openTab(ks, active, (k) => dirty.has(k)));
    setMounted((m) => (m.has(active) ? m : new Set([...m, active])));
  }, [active]);
  useEffect(() => saveTabs(keys), [keys]);
  useLeaveWarning(dirty.size > 0);

  const setDirty = useCallback((key: TabKey, on: boolean) => {
    setDirtySet((d) => {
      if (d.has(key) === on) return d;
      const n = new Set(d);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }, []);

  const close = useCallback(
    (key: TabKey, opts: { force?: boolean; navigate?: boolean } = {}) => {
      if (!opts.force && dirty.has(key) && !window.confirm(CLOSE_MESSAGE)) return false;
      const r = closeTab(keys, key, active);
      setKeys(r.keys);
      setMounted((m) => new Set([...m].filter((k) => k !== key)));
      setDirty(key, false);
      if (opts.navigate !== false && active === key) navigate(r.next ? routeOf(r.next) : { name: "explore" }, { replace: true });
      return true;
    },
    [keys, active, dirty, setDirty],
  );

  const replace = useCallback((from: TabKey, to: TabKey) => {
    setKeys((ks) => replaceTab(ks, from, to));
    setMounted((m) => new Set([...m].map((k) => (k === from ? to : k))));
    setDirty(from, false);
  }, [setDirty]);

  const move = useCallback((from: number, to: number) => setKeys((ks) => moveTab(ks, from, to)), []);

  const value = useMemo(() => ({ keys, active, dirty, mounted, setDirty, close, replace, move }), [keys, active, dirty, mounted, setDirty, close, replace, move]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): Tabs {
  const t = useContext(Ctx);
  if (!t) throw new Error("TabsProvider missing");
  return t;
}

// 로그인 상태, 내 와일드카드 목록, 즐겨찾기, 나만 보는 폴더. 사이드바·편집기·자동완성이 같이 쓴다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type Card, type Folder, type WildcardMeta } from "../lib/api.ts";
import { primeMeta } from "./cache.ts";

export interface Session {
  /** undefined = 아직 모름, null = 로그인 안 함 */
  user: string | null | undefined;
  mine: WildcardMeta[];
  favorites: Card[];
  /** 폴더와 든 와일드카드 ID (DESIGN 11절 "폴더"). 내 목록과는 따로 받는다 */
  folders: Folder[];
  setUser(u: string | null): void;
  refreshMine(): Promise<void>;
  refreshFavorites(): Promise<void>;
  refreshFolders(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [mine, setMine] = useState<WildcardMeta[]>([]);
  const [favorites, setFavorites] = useState<Card[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.username))
      .catch((e) => setUser(e instanceof ApiError && e.status === 401 ? null : null));
  }, []);

  const refreshMine = useCallback(async () => {
    if (!user) return setMine([]);
    const r = await api.mine();
    setMine(r.wildcards);
  }, [user]);
  const refreshFavorites = useCallback(async () => {
    if (!user) return setFavorites([]);
    const r = await api.favorites();
    primeMeta(r.favorites);
    setFavorites(r.favorites);
  }, [user]);

  const refreshFolders = useCallback(async () => {
    if (!user) return setFolders([]);
    const r = await api.folders();
    setFolders(r.folders);
  }, [user]);

  useEffect(() => {
    void refreshMine().catch(() => {});
    void refreshFavorites().catch(() => {});
    void refreshFolders().catch(() => {});
  }, [refreshMine, refreshFavorites, refreshFolders]);

  const value = useMemo(
    () => ({ user, mine, favorites, folders, setUser, refreshMine, refreshFavorites, refreshFolders }),
    [user, mine, favorites, folders, refreshMine, refreshFavorites, refreshFolders],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}

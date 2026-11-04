// 왼쪽 사이드바 (DESIGN 11절): 내 것 검색, 내 와일드카드(평평한 목록), 즐겨찾기, 새 와일드카드, 둘러보기.
// 복사본은 원작자를 붙여 보이고, "가져온 것 숨기기"(기본 꺼짐, 이 브라우저에 기억)로 감출 수 있다.

import { useState } from "react";
import { Link, useRoute } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import { loadFlag, saveFlag } from "../lib/drafts.ts";

export function Sidebar({ onNavigate }: { onNavigate?(): void }) {
  const { user, mine, favorites } = useSession();
  const route = useRoute();
  const [q, setQ] = useState("");
  const [hideCopies, setHideCopies] = useState(() => loadFlag("hide-copies"));
  const current = route.name === "wildcard" ? route.id : null;
  const query = q.trim().toLowerCase();
  const list = mine.filter((w) => (!hideCopies || !w.forkedFrom) && (query === "" || w.name.toLowerCase().includes(query)));
  const favs = favorites.filter((w) => query === "" || w.name.toLowerCase().includes(query));

  return (
    <nav className="sidebar" aria-label="내 와일드카드" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <div className="sidebar-actions">
        <Link to={{ name: "new" }} className="btn btn-sm">
          + 새 와일드카드
        </Link>
        <Link to={{ name: "explore" }} className="btn btn-secondary btn-sm">
          둘러보기
        </Link>
      </div>
      {user && (
        <>
          <input className="input input-sm" placeholder="내 것 검색" aria-label="내 것 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="label sidebar-filter">
            <input
              type="checkbox"
              checked={hideCopies}
              onChange={(e) => {
                setHideCopies(e.target.checked);
                saveFlag("hide-copies", e.target.checked);
              }}
            />
            가져온 것 숨기기
          </label>
          <h2 className="sidebar-title">내 와일드카드 ({list.length})</h2>
          <ul className="sidebar-list">
            {list.map((w) => (
              <li key={w.id}>
                <Link to={{ name: "wildcard", id: w.id }} className={"sidebar-item" + (w.id === current ? " is-current" : "")}>
                  <span className="sidebar-name">{w.name}</span>
                  {w.forkedFrom && <span className="sidebar-origin">· {w.forkedFrom.owner ?? "가져옴"}</span>}
                </Link>
              </li>
            ))}
            {list.length === 0 && <li className="text-muted sidebar-empty">{mine.length === 0 ? "아직 없습니다" : "맞는 것이 없습니다"}</li>}
          </ul>
          <h2 className="sidebar-title">즐겨찾기 ({favs.length})</h2>
          <ul className="sidebar-list">
            {favs.map((w) => (
              <li key={w.id}>
                <Link to={{ name: "wildcard", id: w.id }} className={"sidebar-item" + (w.id === current ? " is-current" : "")}>
                  <span className="sidebar-name">{w.name}</span>
                  <span className="sidebar-origin">· {w.owner}</span>
                </Link>
              </li>
            ))}
            {favs.length === 0 && <li className="text-muted sidebar-empty">없음</li>}
          </ul>
        </>
      )}
    </nav>
  );
}

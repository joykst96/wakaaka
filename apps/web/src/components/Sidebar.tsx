// 왼쪽 사이드바 (DESIGN 11절): 내 것 검색, 내 와일드카드(폴더별로 접고 펴는 목록), 즐겨찾기, 새 와일드카드, 둘러보기.
// 복사본은 원작자를 붙여 보이고, "가져온 것 숨기기"(기본 꺼짐, 이 브라우저에 기억)로 감출 수 있다.
// 폴더(DESIGN 11절 "폴더")는 위에, "폴더 없음"인 것은 그 아래에 둔다. 폴더가 없으면 예전처럼 평평한 목록이다.
// 접은 폴더는 이 브라우저에 기억한다. 검색 중이거나 지금 연 와일드카드가 든 폴더는 펼쳐 보인다.
// 우클릭 메뉴(새 폴더·폴더 지우기)와 끌어 놓기(폴더 사이 옮기기)는 FolderTools.tsx(DESIGN 11절 "우클릭 메뉴", "끌어 놓기").

import { useState } from "react";
import { Link, useRoute } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import type { WildcardMeta } from "../lib/api.ts";
import { loadFlag, saveFlag } from "../lib/drafts.ts";
import { groupByFolder, loadCollapsed, saveCollapsed } from "../lib/folders.ts";
import { useFolderTools } from "./FolderTools.tsx";

export function Sidebar({ onNavigate }: { onNavigate?(): void }) {
  const { user, mine, favorites, folders } = useSession();
  const route = useRoute();
  const [q, setQ] = useState("");
  const [hideCopies, setHideCopies] = useState(() => loadFlag("hide-copies"));
  const [collapsed, setCollapsed] = useState(() => loadCollapsed());
  const current = route.name === "wildcard" ? route.id : null;
  const query = q.trim().toLowerCase();
  const list = mine.filter((w) => (!hideCopies || !w.forkedFrom) && (query === "" || w.name.toLowerCase().includes(query)));
  const favs = favorites.filter((w) => query === "" || w.name.toLowerCase().includes(query));
  const grouped = groupByFolder(list, folders);
  const tools = useFolderTools();
  const folderIds = new Set(folders.map((f) => f.id));
  // 새 폴더 칸: 기준 폴더 다음. 기준이 없거나(맨 끝) 사라졌으면 폴더들 다음
  const draftAt = tools.draft ? (tools.draft.after !== undefined && folderIds.has(tools.draft.after) ? tools.draft.after : "end") : null;
  const draftRow = (
    <li key="new-folder" className="folder-new">
      {tools.draftInput()}
    </li>
  );

  const toggle = (id: string) => {
    // 지운 폴더의 기록은 이때 같이 버린다
    const next = new Set([...collapsed].filter((c) => folders.some((f) => f.id === c)));
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    saveCollapsed(next);
  };
  const item = (w: WildcardMeta) => (
    <li key={w.id} data-drag={w.id} data-folder-menu={"wildcard:" + w.id} className={tools.dragging?.includes(w.id) ? "is-dragged" : undefined}>
      <Link to={{ name: "wildcard", id: w.id }} className={"sidebar-item" + (w.id === current ? " is-current" : "")}>
        <span className="sidebar-name">{w.name}</span>
        {w.forkedFrom && <span className="sidebar-origin">· {w.forkedFrom.owner ?? "가져옴"}</span>}
      </Link>
    </li>
  );

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
          <div className="folder-tree" {...tools.containerProps}>
          <div className="folder-head" data-folder-menu="end">
            <h2 className="sidebar-title">내 와일드카드 ({list.length})</h2>
            <Link to={{ name: "folders" }} className="btn btn-ghost btn-sm" title="폴더 만들기, 옮기기, 이름 바꾸기, 지우기">
              폴더 정리
            </Link>
          </div>
          {tools.error && (
            <p className="text-danger sidebar-error" role="alert">
              {tools.error}
            </p>
          )}
          <ul className="sidebar-list folder-list" data-folder-menu="end" data-drop="none">
            {grouped.folders.map(({ folder, items }) => {
              // 검색 중에는 맞는 것이 든 폴더만 보인다(새 폴더 칸의 기준 폴더는 남긴다)
              if (query !== "" && items.length === 0 && draftAt !== folder.id) return null;
              const open = query !== "" || !collapsed.has(folder.id) || items.some((w) => w.id === current);
              return [
                <li key={"f:" + folder.id} data-drop={folder.id}>
                  <button
                    type="button"
                    className="sidebar-item folder-toggle"
                    aria-expanded={open}
                    onClick={() => toggle(folder.id)}
                    data-folder-menu={"folder:" + folder.id}
                    data-drop-hint={folder.id}
                  >
                    <span className="folder-caret" aria-hidden="true">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="sidebar-name">{folder.name}</span>
                    <span className="sidebar-origin">{items.length}</span>
                  </button>
                  {open && items.length > 0 && <ul className="sidebar-list folder-items">{items.map(item)}</ul>}
                </li>,
                draftAt === folder.id && draftRow,
              ];
            })}
            {draftAt === "end" && draftRow}
            {grouped.loose.map(item)}
            {tools.dragging && folders.length > 0 && (
              <li className="folder-dropzone" data-drop="none" data-drop-hint="none">
                폴더 없음으로 꺼내기
              </li>
            )}
            {list.length === 0 && <li className="text-muted sidebar-empty">{mine.length === 0 ? "아직 없습니다" : "맞는 것이 없습니다"}</li>}
          </ul>
          {tools.overlay}
          </div>
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

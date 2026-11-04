// 편집 화면 탭 줄 (DESIGN 11절 "탭"): 이름, 저장 안 함 ●, 닫기 ×(가운데 클릭도), 끌어서 순서 바꾸기.

import { useRef, type DragEvent } from "react";
import { getMeta, requestMeta, useMetaVersion } from "../app/cache.ts";
import { Link } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import { useTabs } from "../app/tabs.tsx";
import { routeOf, type TabKey } from "../lib/tabs.ts";

export function TabBar() {
  const { keys, active, dirty, close, move } = useTabs();
  const { mine } = useSession();
  useMetaVersion();
  const dragFrom = useRef<number | null>(null);
  if (keys.length === 0) return null;

  const ids = keys.filter((k) => k !== "new").map((k) => k.slice(2));
  requestMeta(ids.filter((id) => !mine.some((w) => w.id === id)));
  const label = (k: TabKey) => {
    if (k === "new") return "새 와일드카드";
    const id = k.slice(2);
    return mine.find((w) => w.id === id)?.name ?? getMeta(id)?.name ?? (getMeta(id) === null ? "없는 와일드카드" : "…");
  };
  const owner = (k: TabKey) => {
    if (k === "new") return null;
    const id = k.slice(2);
    if (mine.some((w) => w.id === id)) return null;
    return getMeta(id)?.owner ?? null;
  };

  return (
    <div className="tab-bar" role="tablist" aria-label="열린 와일드카드">
      {keys.map((k, i) => {
        const o = owner(k);
        return (
          <div
            key={k}
            role="tab"
            aria-selected={k === active}
            className={"tab" + (k === active ? " is-active" : "")}
            draggable
            onDragStart={(e: DragEvent) => {
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null && dragFrom.current !== i) move(dragFrom.current, i);
              dragFrom.current = null;
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(k);
              }
            }}
          >
            <Link to={routeOf(k)} className="tab-link" title={o ? `${label(k)} · ${o}` : label(k)}>
              {dirty.has(k) && (
                <span className="tab-dirty" aria-label="저장 안 됨">
                  ●
                </span>
              )}
              <span className="tab-name">{label(k)}</span>
              {o && <span className="tab-owner">· {o}</span>}
            </Link>
            <button type="button" className="tab-close" onClick={() => close(k)} aria-label={`${label(k)} 탭 닫기`} title="닫기 (가운데 클릭)">
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

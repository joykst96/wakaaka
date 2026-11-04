// 오른쪽 패널의 나머지: 사용하는 것(하위 트리), 사용되는 곳, 버전 이력 (DESIGN 11절).

import { useEffect, useState } from "react";
import { Link } from "../app/router.tsx";
import { api } from "../lib/api.ts";
import type { TreeNode } from "../lib/preview.ts";

export function DepTree({ nodes }: { nodes: TreeNode[] | null }) {
  return (
    <section className="panel" aria-label="사용하는 것">
      <h2 className="panel-title">사용하는 것</h2>
      {nodes === null ? <p className="text-muted">불러오는 중…</p> : nodes.length === 0 ? <p className="text-muted">다른 와일드카드를 쓰지 않습니다</p> : <TreeList nodes={nodes} />}
    </section>
  );
}

function TreeList({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="tree">
      {nodes.map((n, i) => (
        <li key={`${n.id}-${i}`}>
          {n.missing ? (
            <span className="tree-missing">없는 참조 {n.id}</span>
          ) : (
            <Link to={{ name: "wildcard", id: n.id }} className={n.seen ? "tree-seen" : undefined}>
              {n.name}
            </Link>
          )}
          {n.seen && <span className="tree-seen"> ↑ 위에 있음</span>}
          {n.children.length > 0 && <TreeList nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export function Dependents({ id, refreshKey }: { id: string; refreshKey: unknown }) {
  const [list, setList] = useState<Array<{ id: string; name: string; depth: number }> | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    api
      .dependents(id)
      .then((r) => live && setList(r.dependents))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [id, refreshKey]);
  return (
    <section className="panel" aria-label="사용되는 곳">
      <h2 className="panel-title">사용되는 곳</h2>
      {list === null ? (
        <p className="text-muted">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="text-muted">이 와일드카드를 쓰는 곳이 없습니다</p>
      ) : (
        <ul className="dependents">
          {list.map((d) => (
            <li key={d.id} className={d.depth > 1 ? "is-indirect" : undefined}>
              <Link to={{ name: "wildcard", id: d.id }}>{d.name}</Link>
              {d.depth > 1 && <span className="text-muted"> (건너서 {d.depth}단계)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function VersionHistory({ id, current, latest, onPick, refreshKey }: { id: string; current: number; latest: number; onPick(seq: number): void; refreshKey: unknown }) {
  const [list, setList] = useState<Array<{ seq: number; createdAt: string }> | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api
      .versions(id)
      .then((r) => live && setList(r.versions))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [id, open, refreshKey]);
  return (
    <section className="panel" aria-label="버전 이력">
      <h2 className="panel-title">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          버전 이력 (v{latest}) {open ? "▴" : "▾"}
        </button>
      </h2>
      {open &&
        (list === null ? (
          <p className="text-muted">불러오는 중…</p>
        ) : (
          <ul className="versions">
            {list.map((v) => (
              <li key={v.seq}>
                <button type="button" className={"btn btn-ghost btn-sm" + (v.seq === current ? " is-current" : "")} aria-current={v.seq === current} onClick={() => onPick(v.seq)}>
                  v{v.seq}
                  {v.seq === latest ? " (최신)" : ""}
                </button>
                <span className="text-muted"> {new Date(v.createdAt).toLocaleString("ko-KR")}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

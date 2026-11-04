// 확인 창들: 가져오기 확인(DESIGN 11절 "내 와일드카드 N개로 복사됩니다(이미 있는 복사본 M개는 다시 씀)"),
// 이름 참조 고르기(사용자 결정 2026-11-03: 내 것에 없으면 즐겨찾기 → 둘러보기에서 항상 고르게 한다).
// 네이티브 <dialog>를 쓴다(ui.css .dialog).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { invalidate } from "../app/cache.ts";
import { useSession } from "../app/session.tsx";
import { api, ApiError, type Card, type ImportResult } from "../lib/api.ts";

export function Dialog({ title, children, onClose, className }: { title: string; children: ReactNode; onClose(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} className={"dialog" + (className ? " " + className : "")} onCancel={(e) => (e.preventDefault(), onClose())}>
      <div className="dialog-head">
        <h2 className="dialog-title">{title}</h2>
        <button type="button" className="btn btn-ghost btn-sm dialog-close" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** 가져오기: dryRun으로 개수를 보여 주고, 확인하면 가져온다. 성공하면 루트 복사본 ID로 onDone */
export function ImportDialog({ source, onDone, onClose }: { source: { id: string; name: string; owner: string }; onDone(rootId: string, r: ImportResult): void; onClose(): void }) {
  const { refreshMine } = useSession();
  const [plan, setPlan] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .importWildcard(source.id, true)
      .then(setPlan)
      .catch((e) => setError(e instanceof ApiError ? importMessage(e) : String(e)));
  }, [source.id]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.importWildcard(source.id, false);
      invalidate();
      await refreshMine();
      onDone(r.root, r);
    } catch (e) {
      setError(e instanceof ApiError ? importMessage(e) : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="가져오기" onClose={onClose}>
      <p>
        <strong>{source.name}</strong> <span className="text-muted">({source.owner})</span>을(를) 지금 버전 그대로 의존성까지 내 와일드카드로 복사합니다. 원작자가 나중에 고쳐도 내 쪽은 바뀌지 않습니다.
      </p>
      {error ? (
        <p className="text-danger">{error}</p>
      ) : plan === null ? (
        <p className="text-muted">계산하는 중…</p>
      ) : (
        <p className="dialog-count">
          내 와일드카드 <strong>{plan.created.length}개</strong>로 복사됩니다
          {plan.reused.length > 0 && <> (이미 있는 복사본 {plan.reused.length}개는 다시 씀)</>}.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn" onClick={run} disabled={busy || plan === null || error !== null}>
          {busy ? "가져오는 중…" : "가져오기"}
        </button>
      </div>
    </Dialog>
  );
}

function importMessage(e: ApiError): string {
  if (e.status === 401) return "로그인해야 가져올 수 있습니다";
  if (e.code === "E_IMPORT_OWN") return "이미 내 와일드카드입니다";
  if (e.code === "E_NAME_TAKEN") return "이름이 겹쳐 가져오지 못했습니다";
  return e.message;
}

/** 이름 참조를 고르는 창. 후보: 즐겨찾기(이름이 같은 것 먼저) → 둘러보기 검색. 고르면 onPick(남의 것이므로 부르는 쪽이 가져오기를 이어서 한다) */
export function PickRefDialog({ name, onPick, onClose }: { name: string; onPick(card: Card): void; onClose(): void }) {
  const { favorites } = useSession();
  const [query, setQuery] = useState(name);
  const [found, setFound] = useState<Card[] | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    const t = setTimeout(() => {
      api
        .explore({ q: query })
        .then((r) => live && setFound(r.wildcards))
        .catch(() => live && setFound([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const q = query.trim().toLowerCase();
  const favs = favorites.filter((f) => f.name.toLowerCase().includes(q)).sort((a, b) => Number(b.name.toLowerCase() === q) - Number(a.name.toLowerCase() === q));
  const others = (found ?? []).filter((c) => !favs.some((f) => f.id === c.id));
  const row = (c: Card) => (
    <li key={c.id}>
      <button type="button" className="popover-item pick-row" onClick={() => onPick(c)}>
        <span>{c.name}</span> <span className="text-muted">{c.owner}</span>
        {c.description && <span className="pick-desc">{c.description}</span>}
      </button>
    </li>
  );
  return (
    <Dialog title={`"${name}" 고르기`} onClose={onClose}>
      <p className="text-muted">내 와일드카드에 이 이름이 없습니다. 쓸 것을 고르면 가져오기 확인으로 넘어갑니다.</p>
      <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="검색" autoFocus />
      <h3 className="pick-section">즐겨찾기</h3>
      {favs.length === 0 ? <p className="text-muted">없음</p> : <ul className="pick-list">{favs.map(row)}</ul>}
      <h3 className="pick-section">둘러보기</h3>
      {found === null ? <p className="text-muted">찾는 중…</p> : others.length === 0 ? <p className="text-muted">없음</p> : <ul className="pick-list">{others.map(row)}</ul>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          저장 취소
        </button>
      </div>
    </Dialog>
  );
}

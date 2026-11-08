// 폴더 정리 (DESIGN 11절 "폴더", 사용자 결정 2026-11-08). 나만 보는 정리용이라 로그인한 본인만 쓴다.
// 위: 전체 · 폴더 없음 · 폴더들(이름순) 칩과 새 폴더. 아래: 고른 보기의 와일드카드, 골라서 옮기기, 폴더 이름 바꾸기·지우기.
// 보기는 주소에 둔다(/folders, /folders/none, /folders/{폴더 ID}). 링크는 routes.ts hrefOf로만 만든다.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, navigate } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import { Dialog } from "../components/Dialogs.tsx";
import { api, ApiError, type Folder } from "../lib/api.ts";
import { checkFolderName, folderIndex, groupByFolder } from "../lib/folders.ts";

function messageOf(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  switch (e.code) {
    case "E_FOLDER_NAME_TAKEN":
      return "같은 이름의 폴더가 있습니다.";
    case "E_FOLDER_LIMIT":
      return "폴더는 100개까지 만들 수 있습니다.";
    case "E_FOLDER_NAME":
      return "폴더 이름은 앞뒤 공백 없이 1~64자이고 줄바꿈 같은 제어문자는 쓸 수 없습니다.";
    case "E_FOLDER_NOT_FOUND":
      return "폴더가 없습니다. 다른 곳에서 지웠을 수 있습니다.";
    case "E_NOT_FOUND":
      return "지운 와일드카드가 섞여 있습니다. 목록을 새로 받았으니 다시 골라 주세요.";
    default:
      return e.message;
  }
}

export function FoldersPage({ view }: { view?: string }) {
  const { user, mine, folders, refreshFolders, refreshMine } = useSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);

  const grouped = useMemo(() => groupByFolder(mine, folders), [mine, folders]);
  const index = useMemo(() => folderIndex(folders), [folders]);
  const folder = view !== undefined && view !== "none" ? folders.find((f) => f.id === view) : undefined;
  const shown = view === undefined ? mine : view === "none" ? grouped.loose : (grouped.folders.find((g) => g.folder.id === view)?.items ?? []);

  // 보기가 바뀌면 고른 것을 비운다. 목록이 바뀌면 사라진 것만 뺀다
  useEffect(() => setSelected(new Set()), [view]);
  useEffect(() => {
    setSelected((s) => {
      const live = new Set(mine.map((w) => w.id));
      const next = new Set([...s].filter((id) => live.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [mine]);
  useEffect(() => setRenaming(null), [view]);

  if (user === undefined) return null;
  if (user === null) {
    return (
      <div className="page page-narrow">
        <h1 className="page-title">폴더 정리</h1>
        <p>
          <Link to={{ name: "login" }}>로그인</Link>하면 내 와일드카드를 폴더로 나눌 수 있습니다. 폴더는 나만 봅니다.
        </p>
      </div>
    );
  }
  // 없는 폴더(지웠거나 남의 것) 주소는 전체로
  if (view !== undefined && view !== "none" && !folder && folders.length > 0) {
    return (
      <div className="page">
        <h1 className="page-title">폴더 정리</h1>
        <p className="text-muted">
          폴더를 찾을 수 없습니다. <Link to={{ name: "folders" }}>전체 보기</Link>
        </p>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && (e.code === "E_NOT_FOUND" || e.code === "E_FOLDER_NOT_FOUND")) await Promise.all([refreshMine(), refreshFolders()]).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const c = checkFolderName(newName, folders);
    if ("error" in c) return setError(c.error);
    void run(async () => {
      const f = await api.createFolder(c.name);
      setNewName("");
      await refreshFolders();
      navigate({ name: "folders", folder: f.id });
    });
  };

  const moveSelected = () => {
    const ids = shown.filter((w) => selected.has(w.id)).map((w) => w.id);
    if (ids.length === 0) return;
    void run(async () => {
      await api.moveToFolder(target === "" ? null : target, ids);
      setSelected(new Set());
      await refreshFolders();
    });
  };

  const allChecked = shown.length > 0 && shown.every((w) => selected.has(w.id));
  const count = shown.filter((w) => selected.has(w.id)).length;
  const viewChip = (to: string | undefined, label: string, n: number) => (
    <button key={to ?? "all"} type="button" className="chip" aria-pressed={view === to} onClick={() => navigate({ name: "folders", folder: to })}>
      {label} <span className="text-muted">{n}</span>
    </button>
  );

  return (
    <div className="page folders-page">
      <h1 className="page-title">폴더 정리</h1>
      <p className="text-muted">폴더는 나만 봅니다. 둘러보기, 사용자 페이지, ComfyUI 노드에는 나오지 않습니다. 폴더를 바꿔도 새 버전이 생기지 않습니다.</p>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="folders-layout">
        <section className="panel folders-nav" aria-label="폴더 목록">
          <div className="chip-group" role="group" aria-label="보기">
            {viewChip(undefined, "전체", mine.length)}
            {viewChip("none", "폴더 없음", grouped.loose.length)}
            {grouped.folders.map((g) => viewChip(g.folder.id, g.folder.name, g.items.length))}
          </div>
          <form className="folders-new" onSubmit={create}>
            <input className="input input-sm" placeholder="새 폴더 이름" aria-label="새 폴더 이름" value={newName} maxLength={200} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn btn-sm" disabled={busy}>
              만들기
            </button>
          </form>
        </section>

        <section className="panel folders-main" aria-label="와일드카드">
          <div className="folders-title">
            {folder && renaming === folder.id ? (
              <RenameForm folder={folder} folders={folders} busy={busy} onCancel={() => setRenaming(null)} onSave={(name) => run(async () => (await api.renameFolder(folder.id, name), await refreshFolders(), setRenaming(null)))} onError={setError} />
            ) : (
              <>
                <h2 className="panel-title">{view === undefined ? "전체" : view === "none" ? "폴더 없음" : (folder?.name ?? "…")}</h2>
                {folder && (
                  <span className="folders-title-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(folder.id)} disabled={busy}>
                      이름 바꾸기
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(folder)} disabled={busy}>
                      지우기
                    </button>
                  </span>
                )}
              </>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="text-muted">{mine.length === 0 ? "아직 와일드카드가 없습니다." : "이 폴더는 비어 있습니다. 다른 보기에서 골라 옮겨 넣으세요."}</p>
          ) : (
            <>
              <div className="folders-bar">
                <label className="label">
                  <input type="checkbox" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((w) => w.id)) : new Set())} />
                  모두 고르기
                </label>
                <span className="folders-bar-move">
                  <span className="text-muted">{count}개를</span>
                  <select className="input input-sm" aria-label="옮길 폴더" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">폴더 없음</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-sm" onClick={moveSelected} disabled={busy || count === 0}>
                    옮기기
                  </button>
                </span>
              </div>
              <ul className="folders-items">
                {shown.map((w) => (
                  <li key={w.id} className="folders-item">
                    <label className="label folders-check">
                      <input
                        type="checkbox"
                        checked={selected.has(w.id)}
                        aria-label={`${w.name} 고르기`}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(w.id);
                          else next.delete(w.id);
                          setSelected(next);
                        }}
                      />
                    </label>
                    <Link to={{ name: "wildcard", id: w.id }} className="folders-name">
                      {w.name}
                    </Link>
                    {w.forkedFrom && <span className="sidebar-origin">· {w.forkedFrom.owner ?? "가져옴"}</span>}
                    {view === undefined && <span className="folders-where text-muted">{index.get(w.id)?.name ?? "폴더 없음"}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {deleting && (
        <Dialog title="폴더 지우기" onClose={() => setDeleting(null)}>
          <p>
            폴더 <strong>{deleting.name}</strong>을(를) 지웁니다. 안의 와일드카드 {grouped.folders.find((g) => g.folder.id === deleting.id)?.items.length ?? 0}개는 지우지 않고 "폴더 없음"으로 옮깁니다.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>
              취소
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.deleteFolder(deleting.id);
                  setDeleting(null);
                  await refreshFolders();
                  navigate({ name: "folders", folder: "none" }, { replace: true });
                })
              }
            >
              지우기
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function RenameForm({
  folder,
  folders,
  busy,
  onSave,
  onCancel,
  onError,
}: {
  folder: Folder;
  folders: Folder[];
  busy: boolean;
  onSave(name: string): void;
  onCancel(): void;
  onError(msg: string): void;
}) {
  const [name, setName] = useState(folder.name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = checkFolderName(name, folders, folder.id);
    if ("error" in c) return onError(c.error);
    if (c.name === folder.name) return onCancel();
    onSave(c.name);
  };
  return (
    <form className="folders-rename" onSubmit={submit}>
      <input
        className="input input-sm"
        aria-label="폴더 이름"
        value={name}
        maxLength={200}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), onCancel())}
      />
      <button className="btn btn-sm" disabled={busy}>
        저장
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
        취소
      </button>
    </form>
  );
}

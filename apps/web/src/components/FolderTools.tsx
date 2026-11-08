// 폴더 우클릭 메뉴와 끌어 놓기 (사용자 결정 2026-11-09, DESIGN 11절 "우클릭 메뉴", "끌어 놓기").
// 사이드바와 폴더 정리 화면이 같이 쓴다. 쓰는 쪽은 containerProps를 목록을 감싼 요소에 펼치고, 요소에 data 속성을 단다.
//   data-folder-menu="folder:ID" | "wildcard:ID" | "end"  우클릭 메뉴를 여는 곳(lib/folders.ts parseMenuTarget)
//   data-drag="와일드카드 ID"                              끌 수 있는 행
//   data-drop="폴더 ID" | "none"                           놓는 곳(가장 안쪽 것이 이긴다)
//   data-drop-hint="폴더 ID" | "none"                      끄는 동안 강조하는 곳. 위에 올리면 같은 값의 것이 진하게 바뀐다
// 끌기는 라이브러리 없이 포인터 이벤트로 한다(HTML 끌어 놓기 API는 터치에서 안 된다).
//   마우스·펜: 누르고 5px 넘게 움직이면 시작. 그냥 누르면 원래 클릭(링크 열기).
//   터치: 길게(450ms) 누른 뒤 움직이면 시작, 그 전에 움직이면 스크롤. 길게 눌렀다 그냥 떼면 우클릭 메뉴.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useSession } from "../app/session.tsx";
import { api, ApiError, type Folder } from "../lib/api.ts";
import { checkFolderName, dragSet, folderCount, folderErrorMessage, moveLocally, needsMove, newFolderAfter, parseDropTarget, parseMenuTarget, type MenuTarget } from "../lib/folders.ts";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import { Dialog } from "./Dialogs.tsx";

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 450;
/** 끌다가 스크롤 영역 가장자리에 이만큼 가까우면 그쪽으로 스크롤한다(px) */
const SCROLL_EDGE = 32;
const SCROLL_STEP = 12;

export interface FolderToolsOptions {
  /** 폴더 정리 화면에서 고른 것. 고른 것 중 하나를 끌면 고른 것 전부를 옮긴다 */
  selection?: { selected: ReadonlySet<string>; shown: readonly string[] };
  onMoved?(ids: string[], target: string | null): void;
  onDeleted?(id: string): void;
  /** 오류를 쓰는 쪽에서 보이고 싶으면 넘긴다. 없으면 error로 돌려준다 */
  onError?(msg: string | null): void;
}

interface Pending {
  /** 끄는 와일드카드. 끌 수 없는 곳(폴더 머리 등)을 터치로 길게 눌렀으면 "" (메뉴만 연다) */
  id: string;
  source: HTMLElement;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  armed: boolean;
  dragging: boolean;
  timer: number | undefined;
  ids: string[];
  over: HTMLElement | null;
  scroller: HTMLElement | null;
}

const isField = (t: EventTarget | null) => t instanceof Element && t.closest("input, textarea, select, [contenteditable]") !== null;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** 끈 뒤 바로 오는 클릭(링크 열기, 서랍 닫기)을 한 번 막는다. 클릭이 오지 않을 수도 있어 잠깐만 기다린다 */
function swallowNextClick() {
  const h = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    window.removeEventListener("click", h, true);
    window.removeEventListener("pointerdown", done, true);
  };
  window.addEventListener("click", h, true);
  window.addEventListener("pointerdown", done, true);
  setTimeout(done, 400);
}

export function useFolderTools(opts: FolderToolsOptions = {}) {
  const { mine, folders, setFolders, refreshFolders, refreshMine } = useSession();
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget; invoker: HTMLElement | null } | null>(null);
  const [draft, setDraft] = useState<{ after?: string } | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ ids: string[]; label: string } | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const pending = useRef<Pending | null>(null);
  const lastPointer = useRef({ type: "", at: 0 });
  const keyboardAt = useRef(0);
  const cleanup = useRef<() => void>(() => {});
  // 창 이벤트 처리기가 최신 값을 보게
  const latest = useRef({ mine, folders, opts });
  latest.current = { mine, folders, opts };

  const report = (msg: string | null) => (opts.onError ?? setOwnError)(msg);

  useEffect(() => () => cleanup.current(), []);

  // ---------------- 메뉴 ----------------
  const openMenu = (el: Element, x: number, y: number): boolean => {
    const holder = el.closest<HTMLElement>("[data-folder-menu]");
    const target = parseMenuTarget(holder?.dataset.folderMenu);
    if (!holder || !target) return false;
    const invoker = el.closest<HTMLElement>("a, button, [tabindex]");
    setMenu({ x, y, target, invoker });
    return true;
  };

  const onContextMenu = (e: MouseEvent) => {
    // 터치는 길게 누르기를 직접 처리한다(안드로이드는 길게 누르면 contextmenu도 온다)
    if (lastPointer.current.type === "touch" && Date.now() - lastPointer.current.at < 2000) return e.preventDefault();
    if (Date.now() - keyboardAt.current < 1000) return e.preventDefault();
    if (isField(e.target) || !(e.target instanceof Element)) return;
    const el = e.target;
    // 키보드로 연 contextmenu는 좌표가 0이거나 요소 근처라 요소 기준으로 놓는다
    const r = el.getBoundingClientRect();
    const byKeyboard = e.clientX === 0 && e.clientY === 0;
    if (openMenu(el, byKeyboard ? r.left : e.clientX, byKeyboard ? r.bottom : e.clientY)) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) || isField(e.target) || !(e.target instanceof Element)) return;
    const r = e.target.getBoundingClientRect();
    if (openMenu(e.target, r.left + Math.min(r.width / 2, 24), r.bottom)) {
      keyboardAt.current = Date.now();
      e.preventDefault();
    }
  };

  const menuItems = (target: MenuTarget): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: "새 폴더",
        onSelect: () => {
          report(null);
          setDraft({ after: newFolderAfter(target, latest.current.folders) });
        },
      },
    ];
    const f = target.kind === "folder" ? latest.current.folders.find((x) => x.id === target.id) : undefined;
    if (f) items.push({ label: "폴더 지우기", danger: true, onSelect: () => setDeleting(f) });
    return items;
  };

  // ---------------- 끌기 ----------------
  const highlight = (p: Pending, el: HTMLElement | null) => {
    if (p.over === el) return;
    const hints = (v: string | undefined) => (v === undefined ? [] : [...document.querySelectorAll<HTMLElement>(`[data-drop-hint="${CSS.escape(v)}"]`)]);
    for (const h of hints(p.over?.dataset.drop)) h.classList.remove("is-drop-over");
    for (const h of hints(el?.dataset.drop)) h.classList.add("is-drop-over");
    p.over = el;
  };

  const placeGhost = () => {
    if (ghost.current) ghost.current.style.transform = `translate(${pos.current.x + 12}px, ${pos.current.y + 12}px)`;
  };

  const startDrag = (p: Pending) => {
    p.dragging = true;
    const sel = latest.current.opts.selection;
    p.ids = sel ? dragSet(p.id, sel.selected, sel.shown) : [p.id];
    const name = latest.current.mine.find((w) => w.id === p.id)?.name ?? "";
    p.scroller = scrollParent(p.source);
    p.source.classList.remove("is-pressed");
    document.body.classList.add("is-folder-dragging");
    setMenu(null);
    setDrag({ ids: p.ids, label: p.ids.length > 1 ? `${p.ids.length}개` : name });
  };

  const finish = () => {
    const p = pending.current;
    if (p) {
      clearTimeout(p.timer);
      highlight(p, null);
      p.source.classList.remove("is-pressed");
    }
    pending.current = null;
    document.body.classList.remove("is-folder-dragging");
    setDrag(null);
    cleanup.current();
    cleanup.current = () => {};
  };

  const move = async (ids: string[], target: string | null) => {
    const prev = latest.current.folders;
    const todo = needsMove(ids, target, prev);
    if (todo.length === 0) return;
    setFolders(moveLocally(prev, todo, target));
    report(null);
    try {
      await api.moveToFolder(target, todo);
      latest.current.opts.onMoved?.(todo, target);
      await refreshFolders().catch(() => {});
    } catch (e) {
      // 화면을 되돌리고 서버 값을 다시 받는다
      setFolders(prev);
      report(`옮기지 못했습니다. ${folderErrorMessage(e)}`);
      await Promise.all([refreshFolders(), e instanceof ApiError && e.code === "E_NOT_FOUND" ? refreshMine() : undefined]).catch(() => {});
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    lastPointer.current = { type: e.pointerType, at: Date.now() };
    if (e.button !== 0 || !e.isPrimary || pending.current) return;
    if (!(e.target instanceof Element) || isField(e.target)) return;
    const touch = e.pointerType === "touch";
    const dragEl = e.target.closest<HTMLElement>("[data-drag]");
    const source = dragEl ?? (touch ? e.target.closest<HTMLElement>("[data-folder-menu]") : null);
    if (!source) return;
    const id = dragEl?.dataset.drag ?? "";
    const p: Pending = { id, source, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, armed: false, dragging: false, timer: undefined, ids: [], over: null, scroller: null };
    pending.current = p;
    pos.current = { x: e.clientX, y: e.clientY };
    if (p.touch) {
      p.timer = window.setTimeout(() => {
        p.armed = true;
        source.classList.add("is-pressed");
        try {
          navigator.vibrate?.(10);
        } catch {}
      }, LONG_PRESS_MS);
    }

    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      pos.current = { x: ev.clientX, y: ev.clientY };
      const d = Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0);
      if (!p.dragging) {
        if (!p.touch) {
          if (d > MOUSE_SLOP) startDrag(p);
        } else if (!p.armed) {
          if (d > TOUCH_SLOP) finish(); // 스크롤이다
        } else if (d > TOUCH_SLOP) {
          if (p.id) startDrag(p);
          else finish();
        }
        if (!p.dragging) return;
      }
      placeGhost();
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = hit?.closest<HTMLElement>("[data-drop]") ?? null;
      highlight(p, over && parseDropTarget(over.dataset.drop) !== undefined ? over : null);
      const s = p.scroller;
      if (s) {
        const r = s.getBoundingClientRect();
        if (ev.clientY < r.top + SCROLL_EDGE) s.scrollTop -= SCROLL_STEP;
        else if (ev.clientY > r.bottom - SCROLL_EDGE) s.scrollTop += SCROLL_STEP;
      }
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      if (p.dragging) {
        const target = parseDropTarget(p.over?.dataset.drop);
        const ids = p.ids;
        finish();
        swallowNextClick();
        if (target !== undefined) void move(ids, target);
      } else if (p.armed) {
        // 길게 눌렀다 뗌: 우클릭 메뉴
        finish();
        swallowNextClick();
        openMenu(p.source, ev.clientX, ev.clientY);
      } else finish();
    };
    const onCancel = (ev: globalThis.PointerEvent) => ev.pointerId === p.pointerId && finish();
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape" && p.dragging) {
        ev.preventDefault();
        finish();
      }
    };
    // 길게 누른 뒤에는 화면이 스크롤되지 않게(리스너가 passive가 아니어야 막힌다)
    const onTouchMove = (ev: TouchEvent) => {
      if ((p.armed && p.id) || p.dragging) ev.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchmove", onTouchMove);
    };
  };

  // 링크·글자의 브라우저 끌기를 막는다(시작되면 포인터 이벤트가 끊긴다)
  const onDragStart = (e: DragEvent) => {
    if (e.target instanceof Element && e.target.closest("[data-drag]")) e.preventDefault();
  };

  // ---------------- 만들기·지우기 ----------------
  const commitDraft = async (input: string): Promise<boolean> => {
    if (!draft) return true;
    const c = checkFolderName(input, latest.current.folders);
    if ("error" in c) {
      report(c.error);
      return false;
    }
    setBusy(true);
    try {
      await api.createFolder(c.name, draft.after);
      setDraft(null);
      report(null);
      await refreshFolders().catch(() => {});
      return true;
    } catch (e) {
      report(folderErrorMessage(e));
      if (e instanceof ApiError && e.code === "E_FOLDER_NOT_FOUND") {
        // 기준 폴더가 그새 지워졌다. 자리는 맨 끝으로
        setDraft({});
        await refreshFolders().catch(() => {});
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (f: Folder) => {
    setBusy(true);
    try {
      await api.deleteFolder(f.id);
      setDeleting(null);
      report(null);
      await refreshFolders().catch(() => {});
      latest.current.opts.onDeleted?.(f.id);
    } catch (e) {
      setDeleting(null);
      report(folderErrorMessage(e));
      await refreshFolders().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const draftInput = (className?: string) =>
    draft && <NewFolderInput className={className} busy={busy} onCommit={commitDraft} onCancel={() => (setDraft(null), report(null))} />;

  const n = deleting ? folderCount(deleting) : 0;
  const overlay = (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="폴더"
          items={menuItems(menu.target)}
          onClose={(restore) => {
            if (restore && menu.invoker?.isConnected) menu.invoker.focus({ preventScroll: true });
            setMenu(null);
          }}
        />
      )}
      {drag &&
        createPortal(
          <div ref={(el) => ((ghost.current = el), placeGhost())} className="folder-ghost" aria-hidden="true">
            {drag.label}
          </div>,
          document.body,
        )}
      {deleting && (
        <Dialog title="폴더 지우기" onClose={() => setDeleting(null)}>
          <p>
            폴더 <strong>{deleting.name}</strong>을(를) 지웁니다.{" "}
            {n > 0 ? <>안의 와일드카드 {n}개는 "폴더 없음"으로 옮겨집니다. 와일드카드는 지우지 않습니다.</> : "빈 폴더입니다."}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>
              취소
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirmDelete(deleting)}>
              지우기
            </button>
          </div>
        </Dialog>
      )}
    </>
  );

  return {
    containerProps: { onContextMenu, onKeyDown, onPointerDown, onDragStart },
    /** 끄는 중이면 끄는 와일드카드 ID */
    dragging: drag?.ids ?? null,
    /** 새 폴더 입력 칸을 띄울 자리: { after: 폴더 ID } 그 다음, { after: undefined } 맨 끝. null이면 없음 */
    draft,
    draftInput,
    error: ownError,
    busy,
    askDelete: setDeleting,
    move,
    overlay,
  };
}

/** 새 폴더 이름 칸. Enter나 다른 곳 누르기(이름이 있으면)로 만들고, Esc나 빈 이름이면 그만둔다 */
function NewFolderInput({ className, busy, onCommit, onCancel }: { className?: string; busy: boolean; onCommit(name: string): Promise<boolean>; onCancel(): void }) {
  const [name, setName] = useState("");
  const settled = useRef(false);
  const submit = async () => {
    if (settled.current || busy) return;
    if (name.trim() === "") return (settled.current = true), onCancel();
    settled.current = true;
    if (!(await onCommit(name))) settled.current = false;
  };
  return (
    <input
      className={"input input-sm folder-new-input" + (className ? " " + className : "")}
      aria-label="새 폴더 이름"
      placeholder="새 폴더 이름"
      value={name}
      maxLength={200}
      autoFocus
      readOnly={busy}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          settled.current = true;
          onCancel();
        }
      }}
      onBlur={() => void submit()}
    />
  );
}

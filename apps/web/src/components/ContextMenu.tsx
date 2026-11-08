// 앱 우클릭 메뉴 (DESIGN 11절 "우클릭 메뉴"). 브라우저 메뉴 대신 띄운다.
// 화살표·Home·End로 고르고 Enter·Space로 실행, Esc·Tab·바깥 누르기·스크롤·창 크기 바꾸기로 닫힌다.
// 모바일 사이드바는 transform이 있는 서랍이라 그 안의 position: fixed가 화면 기준이 아니다. 그래서 body에 띄운다.

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
}

/** 화면 가장자리와 띄우는 거리(px). 길이 토큰은 CSS에만 있어 여기서는 수로 둔다 */
const EDGE = 4;

/** onClose(restoreFocus): Esc·Tab·고르기로 닫으면 true(연 곳으로 초점을 돌린다), 바깥 누르기 등은 false */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose(restoreFocus: boolean): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // 화면 밖으로 나가지 않게 자리를 잡고 첫 항목에 초점
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - r.width - EDGE));
    const top = y + r.height + EDGE > window.innerHeight ? Math.max(EDGE, y - r.height) : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current(false);
    };
    const away = () => close.current(false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const list = [...ref.current!.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") close.current(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      className="popover folder-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      // 메뉴 키로 열면 keyup에서 브라우저 메뉴가 메뉴 항목 위로 한 번 더 온다
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={"popover-item folder-menu-item" + (it.danger ? " is-danger" : "")}
          onClick={() => {
            close.current(true);
            it.onSelect();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

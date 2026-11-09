// 토스트 (DESIGN 11절 "토스트"): 오른쪽 아래에 잠깐 떴다 사라지는 알림. 어느 화면에서든 useToast()로 띄운다.
// 규칙(쌓기·개수·시간·읽기 방식)은 lib/toasts.ts. 마우스를 올리거나 포커스가 안에 있으면 시간이 멈추고, 떠나면 처음부터 다시 센다.
// 화면 읽기 프로그램: 읽기 영역(status, alert)은 늘 DOM에 두고 그 안에 토스트를 넣는다(영역을 새로 만들면 읽지 않는 경우가 있다).

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { dropToast, pushToast, roleOf, TOAST_MS, type Toast, type ToastInput, type ToastKind } from "../lib/toasts.ts";

/** 종류 아이콘(눈으로만 구분, 화면 읽기에서는 숨김). 색은 app.css의 .toast-종류 */
const ICON: Record<ToastKind, string> = { info: "i", success: "✓", warning: "!", error: "×" };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

/** 토스트를 띄우는 함수. ToastProvider 밖에서는 아무 일도 하지 않는다 */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((t: ToastInput) => setList((l) => pushToast(l, t, ++seq.current)), []);
  const dismiss = useCallback((id: number) => setList((l) => dropToast(l, id)), []);
  const region = (role: "status" | "alert") => (
    <div className="toast-region" role={role}>
      {list
        .filter((t) => roleOf(t.kind) === role)
        .map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
    </div>
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <section className="toaster" aria-label="알림">
        {region("status")}
        {region("alert")}
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [paused, toast.id, onDismiss]);
  return (
    <div
      className={`toast toast-${toast.kind}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        {ICON[toast.kind]}
      </span>
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="btn btn-ghost btn-sm toast-close" aria-label="알림 닫기" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  );
}

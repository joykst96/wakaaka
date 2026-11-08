// 토스트 목록 규칙 (DESIGN 11절 "토스트"). 화면은 components/Toast.tsx가 그린다.
// 오른쪽 아래에 쌓이고 TOAST_MS 뒤 사라진다. 같은 글이 다시 오면 겹쳐 쌓지 않고 맨 아래로 옮겨 시간을 새로 센다.

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  /** 기본 info */
  kind?: ToastKind;
  text: string;
}

export interface Toast {
  /** 화면 key. 같은 글을 다시 띄우면 새 id라 시간이 처음부터 다시 간다 */
  id: number;
  kind: ToastKind;
  text: string;
}

/** 사라지기까지(사용자 요청 2026-11-09 "3초 정도") */
export const TOAST_MS = 3000;
/** 한 번에 보이는 최대 개수. 넘치면 오래된 것부터 뺀다 */
export const TOAST_MAX = 4;

/** 화면 읽기 프로그램: 동작이 실패한 오류만 바로 끊고 읽는다(alert). 정보·경고는 하던 일이 끝난 뒤(status). 사용자 결정 2026-11-09 */
export const roleOf = (kind: ToastKind): "alert" | "status" => (kind === "error" ? "alert" : "status");

export function pushToast(list: readonly Toast[], input: ToastInput, id: number, max = TOAST_MAX): Toast[] {
  const kind = input.kind ?? "info";
  const rest = list.filter((t) => !(t.kind === kind && t.text === input.text));
  return [...rest, { id, kind, text: input.text }].slice(-max);
}

export const dropToast = (list: readonly Toast[], id: number): Toast[] => list.filter((t) => t.id !== id);

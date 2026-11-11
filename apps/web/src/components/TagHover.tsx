// 태그 정보 호버 (DESIGN 11절 "태그 정보 호버"): 태그 조각에 마우스를 올리면 태그 DB에 있을 때만 설명 상자.
// 조각은 data-tag 속성만 단 span이고(항목 5,000개 읽기 전용 보기에서 조각마다 훅·이벤트를 달지 않는다),
// 앱에 하나 있는 TagTipLayer가 document의 mouseover로 받는다. 상자는 document.body에 고정 위치로 띄운다
// (카드 예시 줄처럼 overflow: hidden인 곳에서도 잘리지 않게). 글자는 React가 이스케이프한다(dangerouslySetInnerHTML 없음).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tagInfo } from "../app/tags.ts";
import type { TagSuggestion } from "../lib/api.ts";
import { tagInfoLines, tagNameOf, tagPieces } from "../editor/tags.ts";

/** 상자와 조각 사이, 화면 가장자리와 상자 사이(px) */
const GAP = 4;

/**
 * 태그 조각 하나. delay(ms) 동안 마우스가 머물면 묻고, 정보가 있으면(또는 note가 있으면) 띄운다.
 * note: 조각에 걸린 진단 글(표기 lint 등). title 대신 상자에 보인다
 */
export function TagHover({ name, delay, note, children }: { name: string; delay: number; note?: string; children: ReactNode }) {
  return (
    <span className="tag-hover" data-tag={name} data-tag-delay={delay} data-tag-note={note}>
      {children}
    </span>
  );
}

type Tip = { info: TagSuggestion | null; note: string | undefined; anchor: DOMRect };

/** 앱에 하나만 둔다(App.tsx) */
export function TagTipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      current = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tag]") : null;
      if (el === current) return;
      close();
      if (!el) return;
      current = el;
      const name = el.dataset.tag!;
      timer = setTimeout(() => {
        timer = null;
        void tagInfo(name).then((info) => {
          const note = el.dataset.tagNote;
          if (current !== el || !el.isConnected || (!info && !note)) return;
          setTip({ info, note, anchor: el.getBoundingClientRect() });
        });
      }, Number(el.dataset.tagDelay) || 0);
    };
    const out = (e: MouseEvent) => {
      if (e.relatedTarget === null) close(); // 창 밖으로
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    // 고정 위치라 스크롤하면 조각과 떨어진다
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      close();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);
  return tip ? createPortal(<TagTip {...tip} />, document.body) : null;
}

function TagTip({ info, note, anchor }: Tip) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 그린 뒤 크기를 재서 조각 아래(넘치면 위)에, 화면 안쪽으로 맞춘다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP));
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - GAP && anchor.top - GAP - height >= GAP ? anchor.top - GAP - height : below;
    setPos({ left, top });
  }, [anchor]);
  const lines = info ? tagInfoLines(info) : null;
  return (
    <div ref={ref} className="tag-tip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}>
      {info && lines && (
        <>
          <span className={`tag-tip-title tag-cat-${info.category}`}>{lines.title}</span>
          <span className="tag-tip-sub">{lines.sub}</span>
          {lines.body !== null && <span>{lines.body}</span>}
          {lines.keywords !== null && <span className="tag-tip-sub">{lines.keywords}</span>}
        </>
      )}
      {note && <span className="tag-tip-note">{note}</span>}
    </div>
  );
}

/** 문법 없는 글(카드 예시 출력 등)을 태그 조각마다 호버로 감싼다 */
export function TagHoverText({ text, delay = 0 }: { text: string; delay?: number }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const p of tagPieces(text)) {
    const name = tagNameOf(p.text);
    if (name === null) continue;
    if (at < p.from) out.push(text.slice(at, p.from));
    out.push(
      <TagHover key={p.from} name={name} delay={delay}>
        {p.text}
      </TagHover>,
    );
    at = p.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

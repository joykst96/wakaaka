// 문법 가이드 모달: 단계별 설명과 예시. 예시 결과는 core expand로 전개한 것(lib/guide.ts).
// 글자는 React가 이스케이프한다. 문단의 `코드`만 code 요소로 그린다(마크다운 렌더러는 쓰지 않는다).

import { useMemo, useState, type ReactNode } from "react";
import { exampleOutputs, GUIDE, type GuideExample } from "../lib/guide.ts";
import { hrefOf } from "../lib/routes.ts";
import { linePrefixLength } from "../lib/textview.ts";
import { StaticText } from "../editor/StaticText.tsx";
import { Dialog } from "./Dialogs.tsx";

/** 백틱으로 감싼 부분만 code로 */
function inline(text: string): ReactNode[] {
  return text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

function Example({ ex }: { ex: GuideExample }) {
  const outputs = useMemo(() => exampleOutputs(ex), [ex]);
  return (
    <div className="guide-example">
      <pre className="code-block guide-code">
        {ex.code.split("\n").map((line, i) => {
          // 텍스트 보기 줄 형식: 맨 앞 가중치는 편집기처럼 따로 칠한다
          const prefix = line.slice(0, linePrefixLength(line));
          return (
            <span key={i} className="guide-line">
              {prefix && <span className="syn-weight">{prefix}</span>}
              <StaticText text={line.slice(prefix.length)} />
            </span>
          );
        })}
      </pre>
      {ex.refs && (
        <p className="guide-refs">
          {Object.entries(ex.refs).map(([name, items]) => (
            <span key={name}>
              <code>{name}</code> = {items.split("\n").join(" / ")}
              {ex.spread?.includes(name) ? " (펼침)" : ""}
            </span>
          ))}
        </p>
      )}
      {ex.count && (
        <p className="guide-refs">
          개수 {ex.count[0]}~{ex.count[1]}
        </p>
      )}
      {ex.caption && <p className="text-muted">{inline(ex.caption)}</p>}
      <div className="guide-outputs" aria-label="결과 예">
        <span className="guide-outputs-label">결과 예 (seed 0부터)</span>
        <ul>
          {outputs.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function GuideDialog({ onClose }: { onClose(): void }) {
  const [i, setI] = useState(0);
  const step = GUIDE[i]!;
  return (
    <Dialog title="문법 가이드" onClose={onClose} className="guide-dialog">
      <ol className="guide-steps" aria-label="단계">
        {GUIDE.map((s, k) => (
          <li key={k}>
            <button type="button" className="chip" aria-pressed={k === i} aria-current={k === i ? "step" : undefined} onClick={() => setI(k)}>
              {k + 1}. {s.title}
            </button>
          </li>
        ))}
      </ol>
      <section className="guide-step" aria-live="polite">
        <h3 className="guide-title">
          {i + 1}. {step.title}
        </h3>
        {step.body.map((p, k) => (
          <p key={k}>{inline(p)}</p>
        ))}
        {step.examples.map((ex, k) => (
          <Example key={`${i}-${k}`} ex={ex} />
        ))}
      </section>
      {/* 태그 데이터 출처 표시(CC BY-SA 4.0, DESIGN 6절 "태그 데이터 원천") */}
      <p className="text-muted guide-credit">
        태그 자동완성의 한국어 설명과 키워드:{" "}
        <a href={hrefOf({ name: "external", to: "tagData" })} target="_blank" rel="noopener noreferrer">
          mengod-hf/danbooru-tags-kr
        </a>{" "}
        (
        <a href={hrefOf({ name: "external", to: "ccBySa4" })} target="_blank" rel="noopener noreferrer">
          CC BY-SA 4.0
        </a>
        ). Danbooru 태그 이름을 밑줄 표기로 바꿔 씁니다.
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setI(i - 1)} disabled={i === 0}>
          이전
        </button>
        {i < GUIDE.length - 1 ? (
          <button type="button" className="btn" onClick={() => setI(i + 1)}>
            다음 ({i + 2}/{GUIDE.length})
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** 가이드를 여는 버튼 */
export function GuideButton({ className = "btn btn-ghost btn-sm" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="문법 가이드" aria-label="문법 가이드">
        ?<span className="guide-label"> 문법 가이드</span>
      </button>
      {open && <GuideDialog onClose={() => setOpen(false)} />}
    </>
  );
}

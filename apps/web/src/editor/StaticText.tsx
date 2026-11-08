// 포커스 없는 항목 텍스트와 읽기 전용 보기. CodeMirror를 항목마다 띄우지 않고(항목 5,000개까지) 같은 토큰으로 그린다.
// 글자는 React가 이스케이프한다(dangerouslySetInnerHTML 없음).

import { useEffect, useState, type ReactNode } from "react";
import { examplesOf, getMeta, useMetaVersion } from "../app/cache.ts";
import { useTagVersion } from "../app/tags.ts";
import { navigate } from "../app/router.tsx";
import { depthClass } from "./cm.ts";
import { diagnose, tokenize, type ForeignKind, type LintContext } from "./syntax.ts";

/** 바깥 표기에 마우스를 올리면 보이는 설명 */
const FOREIGN_TITLE: Record<ForeignKind, string> = {
  comfy: "ComfyUI 강조 (와카아카는 그대로 넘김)",
  lora: "LoRA 등 (와카아카는 그대로 넘김)",
  nai: "NAI 숫자 강조 (와카아카는 그대로 넘김)",
  break: "BREAK (와카아카는 그대로 넘김)",
};

export function chipLabel(id: string): { name: string; origin: string | null; missing: boolean } {
  const m = getMeta(id);
  if (m === undefined) return { name: "…", origin: null, missing: false };
  if (m === null) return { name: "없는 와일드카드", origin: null, missing: true };
  return { name: m.name, origin: m.forkedFrom?.owner ?? null, missing: false };
}

export function RefChip({ id }: { id: string }) {
  useMetaVersion();
  const [open, setOpen] = useState(false);
  const label = chipLabel(id);
  return (
    <span className="ref-chip-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={"ref-chip" + (label.missing ? " ref-chip-missing" : "")}
        onClick={(e) => {
          e.stopPropagation();
          navigate({ name: "wildcard", id });
        }}
      >
        {label.name}
        {label.origin && <span className="ref-chip-origin"> · {label.origin}</span>}
      </button>
      {open && !label.missing && <Peek id={id} />}
    </span>
  );
}

function Peek({ id }: { id: string }) {
  const m = getMeta(id);
  const [examples, setExamples] = useState<string[] | null>(null);
  const version = m?.version;
  useEffect(() => {
    let live = true;
    void examplesOf(id, version).then((xs) => live && setExamples(xs));
    return () => {
      live = false;
    };
  }, [id, version]);
  if (!m) return null;
  return (
    <span className="peek" role="tooltip">
      <span className="peek-title">{m.name}</span>
      <span className="peek-sub">
        {m.owner}
        {m.forkedFrom?.owner ? ` · 원작자 ${m.forkedFrom.owner}` : ""} · v{m.version}
      </span>
      {m.description && <span className="peek-desc">{m.description}</span>}
      <span className="peek-examples">{examples === null ? "예시 불러오는 중…" : examples.length === 0 ? "예시 없음" : examples.map((x, i) => <span key={i}>· {x}</span>)}</span>
    </span>
  );
}

/** 항목 텍스트를 구문 색과 칩으로. lint가 있으면 첫 진단을 밑줄로 */
export function StaticText({ text, lint, placeholder }: { text: string; lint?: LintContext; placeholder?: string }) {
  useTagVersion(); // 표기 lint용 태그 조회가 도착하면 다시 그린다
  if (text === "") return <span className="static-empty">{placeholder ?? "(빈 항목)"}</span>;
  const diags = lint ? diagnose(text, lint) : [];
  const toks = tokenize(text);
  const out: ReactNode[] = [];
  let at = 0;
  const plain = (from: number, to: number) => {
    if (from >= to) return;
    // 진단 범위에 걸치면 밑줄
    let i = from;
    while (i < to) {
      const d = diags.find((d) => d.from <= i && i < d.to);
      const next = d ? Math.min(to, d.to) : Math.min(to, ...diags.filter((d) => d.from > i).map((d) => d.from), to);
      const s = text.slice(i, next);
      out.push(d ? <span key={out.length} className={`lint-${d.severity}`} title={d.message}>{s}</span> : s);
      i = next;
    }
  };
  for (const t of toks) {
    plain(at, t.from);
    const s = text.slice(t.from, t.to);
    const d = diags.find((d) => d.from < t.to && t.from < d.to);
    if (t.type === "wref") out.push(<RefChip key={out.length} id={t.id} />);
    else if (t.type === "nameref") out.push(<span key={out.length} className={"syn-nameref" + (d ? ` lint-${d.severity}` : "")} title={d?.message}>{s}</span>);
    else if (t.type === "escape") out.push(<span key={out.length} className="syn-escape">{s}</span>);
    else if (t.type === "comment") out.push(<span key={out.length} className="syn-comment" title="주석: 결과에 나오지 않는다">{s}</span>);
    else if (t.type === "foreign") out.push(<span key={out.length} className="syn-foreign" title={FOREIGN_TITLE[t.kind]}>{s}</span>);
    else if (t.type === "badref") out.push(<span key={out.length} className="lint-error" title={d?.message}>{s}</span>);
    else if (t.type === "weight") out.push(<span key={out.length} className={"syn-weight" + (d ? ` lint-${d.severity}` : "")} title={d?.message ?? "보기 가중치"}>{s}</span>);
    else out.push(<span key={out.length} className={`syn-choice syn-${depthClass(t.depth)}` + (d ? ` lint-${d.severity}` : "")} title={d?.message}>{s}</span>);
    at = t.to;
  }
  plain(at, text.length);
  return <>{out}</>;
}

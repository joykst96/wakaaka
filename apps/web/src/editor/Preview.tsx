// 미리보기 (DESIGN 11절): seed 입력과 주사위, seed를 하나씩 늘린 결과 5개.
// 결과 위에 마우스를 올리면 그 부분을 낸 항목의 범위를 강조하고 어느 와일드카드의 어느 항목인지 보여 준다(core expand의 sources).

import type { ExpandResult, SourceRange } from "@wakaaka/core";
import { useMemo, useState } from "react";
import { getMeta } from "../app/cache.ts";
import { expandPreview, parseSeed, previewSeeds, segments, type BundleLike } from "../lib/preview.ts";
import { syntaxMessage } from "./syntax.ts";

export interface PreviewProps {
  bundle: BundleLike | null;
  /** 전개 전에 막힌 이유(이름 참조를 못 바꿈, 하위를 못 받음 등) */
  blocked?: string | null;
  /** 편집 중인 와일드카드 ID(루트 출처 표시용) */
  selfId?: string;
  selfName: string;
  onHover?(source: SourceRange | null): void;
}

const ERROR_TEXT: Record<string, string> = {
  E_UNRESOLVED: "찾을 수 없는 참조가 있습니다",
  E_CYCLE: "참조가 순환합니다",
  E_DEPTH: "깊이 상한(16)을 넘습니다",
  E_BUDGET: "전개 횟수 상한(10,000)을 넘습니다",
  E_DOC: "문서 형식 오류",
};

function randomSeed(): string {
  const a = crypto.getRandomValues(new Uint32Array(2));
  // 2^53 미만으로: ComfyUI 화면에서 다루기 쉬운 크기
  return String(((BigInt(a[0]! & 0x1fffff) << 32n) | BigInt(a[1]!)).toString());
}

export function Preview({ bundle, blocked, selfId, selfName, onHover }: PreviewProps) {
  const [seedText, setSeedText] = useState("0");
  const seed = parseSeed(seedText);
  const [hover, setHover] = useState<{ row: number; source: number } | null>(null);
  const results = useMemo(() => (bundle && seed !== null ? expandPreview(bundle, previewSeeds(seed), selfId) : []), [bundle, seed, selfId]);

  const sourceLabel = (s: SourceRange) => {
    const name = s.wildcard === null || s.wildcard === selfId ? selfName || "이 와일드카드" : (getMeta(s.wildcard)?.name ?? bundleName(bundle, s.hash) ?? s.wildcard);
    return `${name} · 항목 ${s.item}`;
  };

  return (
    <section className="panel preview" aria-label="미리보기">
      <h2 className="panel-title">미리보기</h2>
      <div className="preview-seed">
        <label className="label" htmlFor="seed">
          seed
        </label>
        <input id="seed" className={"input input-sm" + (seed === null ? " is-invalid" : "")} inputMode="numeric" value={seedText} onChange={(e) => setSeedText(e.target.value.trim())} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSeedText(randomSeed())} title="무작위 seed">
          🎲
        </button>
      </div>
      {seed === null && <p className="text-danger">seed는 0 이상 2^64 미만의 정수입니다</p>}
      {blocked && <p className="preview-blocked">{blocked}</p>}
      {!blocked && !bundle && <p className="text-muted">불러오는 중…</p>}
      <ol className="preview-results">
        {results.map(({ seed: s, result }, row) => (
          <li key={row} className="preview-result">
            <span className="preview-seed-label">{s.toString()}</span>
            <ResultText
              result={result}
              active={hover?.row === row ? hover.source : -1}
              onHover={(source) => {
                setHover(source < 0 ? null : { row, source });
                onHover?.(source < 0 || !result.ok ? null : result.sources[source]!);
              }}
            />
          </li>
        ))}
      </ol>
      <p className="preview-source" aria-live="polite">
        {hover && results[hover.row]?.result.ok ? sourceLabel((results[hover.row]!.result as { sources: SourceRange[] }).sources[hover.source]!) : "결과에 마우스를 올리면 출처를 보여 줍니다"}
      </p>
    </section>
  );
}

function bundleName(b: BundleLike | null, hash: string): string | undefined {
  return b && Object.hasOwn(b.docs, hash) ? b.docs[hash]!.name : undefined;
}

function ResultText({ result, active, onHover }: { result: ExpandResult; active: number; onHover(source: number): void }) {
  if (!result.ok) {
    return (
      <span className="preview-error">
        {ERROR_TEXT[result.error.code] ?? syntaxMessage(result.error.code)}
        {result.error.item ? ` (항목 ${result.error.item})` : ""}
      </span>
    );
  }
  if (result.text === "") return <span className="text-muted">(빈 결과)</span>;
  const segs = segments(result.text, result.sources);
  const act = active >= 0 ? result.sources[active] : undefined;
  return (
    <span className="preview-text" onMouseLeave={() => onHover(-1)}>
      {segs.map((sg, k) => {
        const lit = act !== undefined && act.start <= sg.start && sg.end <= act.end;
        return (
          <span key={k} className={lit ? "is-lit" : undefined} onMouseEnter={() => onHover(sg.source)}>
            {result.text.slice(sg.start, sg.end)}
          </span>
        );
      })}
    </span>
  );
}

// 선택지 보기 가중치 입력 패널 (편집기 보조). 항목 텍스트의 선택지마다 보기별 가중치 칸과 뽑힐 확률을 보여 주고,
// 고치면 `3*` 표기를 대신 써 준다(lib/choices.ts). 표기를 외우지 않아도 된다.

import { useState } from "react";
import { choicePercents, listChoices, parseWeightInput, setChoiceWeights } from "../lib/choices.ts";
import { depthClass } from "./cm.ts";
import { StaticText } from "./StaticText.tsx";
import { TAG_HOVER_DELAY_EDITOR } from "./tags.ts";

export function ChoiceWeights({ text, onChange, onClose }: { text: string; onChange(text: string): void; onClose(): void }) {
  const choices = listChoices(text);
  // 입력 중인 칸의 글자(틀린 값도 보이게). 키: "선택지번호:보기번호"
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warn, setWarn] = useState<string | null>(null);

  if (choices.length === 0) {
    return (
      <div className="choice-weights" role="group" aria-label="선택지 가중치">
        <p className="text-muted">이 항목에는 고칠 수 있는 선택지가 없습니다(문법 오류가 있으면 먼저 고쳐 주세요).</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          닫기
        </button>
      </div>
    );
  }

  const apply = (ci: number, ai: number, value: string) => {
    const key = `${ci}:${ai}`;
    setDrafts((d) => ({ ...d, [key]: value }));
    const v = parseWeightInput(value);
    if (v === null) return setWarn("가중치는 0~1,000,000 정수입니다(비우면 1)");
    const c = choices[ci]!;
    const ws = c.alts.map((a, i) => (i === ai ? v : a.weight));
    if (choicePercents(ws) === null) return setWarn("모든 보기를 0으로 하면 저장할 수 없습니다");
    setWarn(null);
    onChange(setChoiceWeights(text, c, ws));
  };

  return (
    <div className="choice-weights" role="group" aria-label="선택지 가중치">
      {choices.map((c) => {
        const pct = choicePercents(c.alts.map((a) => a.weight));
        return (
          <div key={c.index} className="choice-weights-choice">
            <span className={`choice-weights-title syn-${depthClass(c.depth)}`}>
              선택지 {c.index + 1}
              {c.depth > 1 ? ` (${c.depth}겹)` : ""}
            </span>
            <table className="choice-weights-table">
              <tbody>
                {c.alts.map((a, ai) => {
                  const key = `${c.index}:${ai}`;
                  return (
                    <tr key={ai}>
                      <td className="choice-weights-alt">
                        <StaticText text={a.raw} placeholder="(빈 보기)" tagDelay={TAG_HOVER_DELAY_EDITOR} />
                      </td>
                      <td>
                        <input
                          className="input input-sm choice-weights-input"
                          inputMode="numeric"
                          placeholder="1"
                          aria-label={`선택지 ${c.index + 1} 보기 ${ai + 1} 가중치`}
                          value={drafts[key] ?? (a.weight === undefined ? "" : String(a.weight))}
                          onChange={(e) => apply(c.index, ai, e.target.value)}
                          onBlur={() => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)))}
                        />
                      </td>
                      <td className="choice-weights-pct">{pct ? `${pct[ai]!.toFixed(pct[ai]! < 10 ? 1 : 0)}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {warn && <p className="text-warning">{warn}</p>}
      <div className="choice-weights-actions">
        <span className="text-muted">
          비우면 1. 텍스트에는 <code>3*보기</code>로 들어갑니다.
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

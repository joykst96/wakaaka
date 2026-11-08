// 내보내기 (DESIGN 11절 오른쪽 패널): 드롭다운(Impact Pack[기본], 와카아카)과 복사 버튼.
// 지금 보이는 내용(저장 안 한 것 포함)을 쓴다. Impact Pack은 core toImpactPrompt(API /api/w/{id}/export와 같은 함수),
// 와카아카는 텍스트 보기 형식. 두 형식 모두 주석 항목은 빼고 내보낸다(Impact Pack은 toImpactPrompt가 뺀다). 변환 경고는 복사하면서 보여 준다(사용자 결정: 경고 후 그대로 복사).

import { toImpactPrompt, type ImpactWarning, type ImpactWarningCode } from "@wakaaka/core";
import { useState } from "react";
import { getMeta } from "../app/cache.ts";
import { useToast } from "../components/Toast.tsx";
import { loadFlag, saveFlag } from "../lib/drafts.ts";
import type { EditItem } from "../lib/editdoc.ts";
import type { BundleLike } from "../lib/preview.ts";
import { itemsToExportText } from "../lib/textview.ts";

type Format = "impact" | "wakaaka";

const WARNING_TEXT: Record<ImpactWarningCode, string> = {
  W_PIPE: "글자 | 가 있어 Impact Pack에서 보기가 나뉩니다",
  W_BRACE: "글자 { } 가 Impact Pack에서 \\{ \\} 로 남습니다",
  W_DOLLARS: "$$ 가 Impact Pack 개수 문법과 겹칩니다",
  W_WILDCARD_FILE: "__이름__ 모양을 Impact Pack이 와일드카드 파일로 읽습니다",
  W_NEWLINE: "줄바꿈을 공백으로 바꿨습니다",
  W_SEP: "구분자에 | $$ { } 가 있어 Impact Pack이 다르게 읽습니다",
  W_SIZE: "결과가 100KB를 넘습니다",
};

export interface ExportPanelProps {
  bundle: BundleLike | null;
  /** 전개 전에 막힌 이유(이름 참조를 못 바꿈 등) */
  blocked?: string | null;
  items: readonly EditItem[];
  selfId?: string;
  selfName: string;
}

export function ExportPanel({ bundle, blocked, items, selfId, selfName }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>(() => (loadFlag("export-wakaaka") ? "wakaaka" : "impact"));
  // 복사 결과는 토스트로 알린다. 변환 경고 목록은 읽고 고칠 수 있게 패널에 남긴다(사용자 결정 2026-11-09)
  const toast = useToast();
  const [warnings, setWarnings] = useState<ImpactWarning[]>([]);

  const where = (w: ImpactWarning) => {
    const name = w.wildcard === null || w.wildcard === selfId ? selfName || "이 와일드카드" : (getMeta(w.wildcard)?.name ?? bundle?.docs[w.hash]?.name ?? w.wildcard);
    return w.item ? `${name} · 항목 ${w.item}` : name;
  };

  const copy = async () => {
    setWarnings([]);
    const fail = (text: string) => toast({ kind: "error", text });
    let text: string;
    let found: ImpactWarning[] = [];
    if (format === "wakaaka") {
      text = itemsToExportText(items); // 주석 항목은 빼고 내보낸다(DESIGN 3절 "주석 항목")
    } else {
      if (blocked) return fail(blocked);
      if (!bundle) return fail("아직 불러오는 중입니다");
      const r = toImpactPrompt(bundle, selfId ? { rootWildcard: selfId } : {});
      if (!r.ok) return fail(`변환할 수 없습니다 (${r.error.code})`);
      text = r.text;
      found = r.warnings;
      setWarnings(found);
    }
    try {
      await navigator.clipboard.writeText(text);
      const done = `${format === "impact" ? "Impact Pack 프롬프트" : "텍스트 보기"}를 복사했습니다 (${text.length.toLocaleString("ko-KR")}자)`;
      toast(found.length > 0 ? { kind: "warning", text: `${done}. 변환 경고 ${found.length}개는 내보내기 패널에 있습니다` } : { kind: "success", text: done });
    } catch {
      fail("클립보드에 쓸 수 없습니다(브라우저가 막음)");
    }
  };

  return (
    <section className="panel export" aria-label="내보내기">
      <h2 className="panel-title">내보내기</h2>
      <div className="export-row">
        <select
          className="input input-sm"
          aria-label="내보낼 형식"
          value={format}
          onChange={(e) => {
            const f = e.target.value as Format;
            setFormat(f);
            saveFlag("export-wakaaka", f === "wakaaka");
            setWarnings([]);
          }}
        >
          <option value="impact">Impact Pack</option>
          <option value="wakaaka">와카아카</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={() => void copy()}>
          복사
        </button>
      </div>
      <p className="text-muted export-help">
        {format === "impact"
          ? "Impact Pack 와일드카드 노드의 텍스트 칸에 붙여 넣습니다. 하위 와일드카드를 모두 펼친 한 줄이고, 뽑힐 확률은 같지만 seed가 같아도 결과는 다릅니다."
          : "텍스트 보기 형식(한 줄에 항목 하나, 3* 가중치)입니다. 다른 와일드카드의 텍스트 보기에 붙여 넣을 수 있습니다. # 주석 줄은 빠집니다."}
      </p>
      {warnings.length > 0 && (
        <ul className="export-warnings" aria-label="변환 경고">
          {warnings.map((w, i) => (
            <li key={i} className="text-warning">
              {WARNING_TEXT[w.code]} <span className="text-muted">({where(w)})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

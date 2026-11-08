// 태그를 프롬프트 텍스트로 넣을 때의 표기 (DESIGN 11절 "자동완성", 사용자 결정 2026-11-04 확정).
// 저장 데이터·서버·전개기는 텍스트 속 태그를 바꾸지 않는다. 이 함수는 넣는 쪽(편집기 자동완성·표기 lint, 예시 생성기)만 쓴다.

/**
 * Danbooru 태그 이름 → 프롬프트 표기.
 * - 밑줄은 모두 공백으로. 다만 영숫자가 2글자 이상 이어진 곳이 없는 이름(이모티콘 `^_^`·`o_o`·`<|>_<|>`, 작가 `t_k_g` 등
 *   옛 danbooru-tags.csv의 34개, mengod-hf 2026-11-04판의 39개)은 그대로 둔다. 분류는 보지 않는다.
 * - 괄호는 ComfyUI 가중치로 읽히지 않게 `\(` `\)`로. ComfyUI 0.43의 이스케이프는 이 둘뿐이라 다른 백슬래시(`\m/`)는 그대로 둔다.
 * 와카아카 문법 이스케이프는 하지 않는다. 텍스트에 넣을 때 `escapeText`를 따로 쓴다.
 */
export function promptTag(name: string): string {
  const s = /[0-9A-Za-z]{2}/.test(name) ? name.replaceAll("_", " ") : name;
  return s.replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/**
 * 글자 그대로 나오도록 와카아카 문법 이스케이프를 붙인다(SPEC 2.2). inChoice면 `|`도 이스케이프한다.
 * 백슬래시는 바로 뒤가 이스케이프 대상이거나 끝일 때만 겹친다. 그래서 `\(` `\m/`는 읽기 쉬운 그대로 남는다.
 * 선택지 보기 맨 앞의 `정수*`는 보기 가중치로 읽힌다(SPEC 2.2 규칙 0). 태그 이름에는 `*`가 없어서(옛 CSV 114,092개, 새 CSV 150,993개 모두 0개, NOTES)
 * 태그를 넣을 때는 일어나지 않는다. 글자 `3*x`로 시작하는 보기가 필요하면 `{1*3*x}`로 쓴다.
 * atStart: 넣는 자리가 항목 텍스트 맨 앞이다. 맨 앞의 `#`는 주석 표시라(SPEC 2.7) `\#`로, 맨 앞의 `\#`는 `\\#`로 넣는다
 * (태그 `#compass` 등 새 CSV 3개). 맨 앞이 아닌 `#`는 글자라 그대로다.
 */
export function escapeText(s: string, inChoice = false, atStart = false): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const n = s[i + 1];
    if (atStart && i === 0 && c === "#") out += "\\#";
    else if (atStart && i === 0 && c === "\\" && n === "#") out += "\\\\";
    else if ("{}$".includes(c) || (inChoice && c === "|")) out += "\\" + c;
    else if (c === "\\" && (n === undefined || "{}$\\".includes(n) || (inChoice && n === "|"))) out += "\\\\";
    else out += c;
  }
  return out;
}

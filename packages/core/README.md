# @wakaaka/core

와일드카드 문서 스키마(zod), 인라인 문법 파서, 전개기, 난수·하위 seed, 내용 해시.
웹 미리보기와 API가 함께 쓴다. `conformance/`의 공통 테스트 세트는 Python 노드(`joykst96/comfyui-wakaaka`)도 사본으로 같이 돌린다. 명세는 `docs/SPEC.md`.

| 파일 | 내용 | 명세 |
|---|---|---|
| `src/schema.ts` | `expandDocSchema`(전개용), `docSchema`·`bundleSchema`(저장·수신용 엄격 스키마), `isSafeString` | SPEC 3절, DESIGN 9절 |
| `src/parser.ts` | `parse(text, mode)`: 구문 트리 또는 오류(코드, UTF-16 위치) | SPEC 2절 |
| `src/expand.ts` | `expand(bundle, seed, options)`: 문자열과 출처 범위, 또는 오류 | SPEC 4~5절 |
| `src/cleanup.ts` | 최종 결과 쉼표 정리와 위치 지도 | SPEC 4.4절 |
| `src/random.ts` | mix64, FNV-1a, derive, H, SplitMix64, bounded, 비복원 추출 | SPEC 6절 |
| `src/tagtext.ts` | 태그를 텍스트로 넣을 때의 표기(`promptTag`)와 문법 이스케이프(`escapeText`). 넣는 쪽만 쓴다(잠정) | DESIGN 11절 |
| `src/export.ts` | `toImpactPrompt`: 묶음을 Impact Pack 와일드카드 노드용 한 줄로(뜻이 바뀌는 글자는 경고) | DESIGN 11절 |
| `src/hash.ts` | JCS 정규화와 내용 해시. `node:crypto`를 써서 `@wakaaka/core/hash`로 따로 가져온다 | SPEC 7절 |

```ts
import { docSchema, expand, parse } from "@wakaaka/core";
import { contentHash } from "@wakaaka/core/hash";

const r = expand(bundle, "12345"); // seed는 10진수 문자열이나 bigint
if (r.ok) console.log(r.text, r.sources);
else console.log(r.error.code);
```

테스트는 루트에서 `npm test`(타입 검사 + vitest). 공통 테스트 세트 파일을 그대로 읽어 돌린다.

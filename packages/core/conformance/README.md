# 공통 테스트 세트 (conformance)

TS 전개기(`packages/core`)와 Python 전개기(별도 저장소 `joykst96/comfyui-wakaaka`의 `tests/conformance`에 이 폴더의 사본)가 둘 다 통과해야 하는 테스트다. 명세는 `docs/SPEC.md`.
명세를 바꿀 때는 이 테스트 세트를 먼저 고친다.

| 파일 | 내용 | 명세 |
|---|---|---|
| `syntax.json` | 인라인 문법 파서: 텍스트 → 구문 트리 또는 오류 코드 (83개) | 2절 |
| `primitives.json` | 기본 연산 벡터: FNV-1a, mix64, SplitMix64, derive, H, bounded, 비복원 추출(6절), 쉼표 정리(4.4절) (56개) | 4.4, 6절 |
| `expand/*.json` | 전개: 묶음 + seed → 문자열 또는 오류 코드 (46개 사례, 243회 실행) | 3~5절 |
| `hash.json` | 내용 해시: base62(8개), JCS 정규화(6개), 문서 → JCS·sha256·해시(5개) (19개) | 7절 |

## 형식

### syntax.json

```json
{ "name": "choice", "text": "{a|b}", "mode": "stored", "expect": { "ast": [{ "choice": [["a"], ["b"]] }] } }
```

- `mode`: `stored`(기본, 저장 형태) 또는 `edit`(이름 참조 허용).
- `expect`: `ast`(SPEC 2.4절 표기와 정확히 같아야 함), `error`(오류 코드), `ok: true`(파싱 성공만 확인, 64겹 중첩처럼 트리가 너무 긴 경우) 중 하나.

### primitives.json

64비트 값은 16진수 16자리 소문자, seed와 `bounded`의 `n`·결과는 10진수 문자열이다.

- `splitmix64`: seed로 만든 생성기의 처음 8개 출력.
- `bounded`: seed로 만든 생성기 **하나**로 `n` 목록을 차례로 뽑은 결과. 앞의 호출이 몇 번 뽑았는지가 뒤 결과에 드러난다.
- `sample`: seed로 만든 생성기로 `weights`에서 `k`번 비복원 추출한 인덱스(뽑힌 순서).
- `cleanup`: 최종 결과 쉼표 정리의 입력과 출력. 기대값을 손으로 썼고 `check.py --update`가 덮어쓰지 않는다.

### expand/NN-이름.json

```json
{
  "name": "spread-basic",
  "about": "설명",
  "covers": ["spread"],
  "limits": { "maxDepth": 2 },
  "bundle": { "format": 1, "root": "…", "lock": { }, "docs": { } },
  "runs": [ { "seed": "0", "text": "white, red" }, { "seed": "5", "error": "E_BUDGET" } ]
}
```

- `bundle`은 `DESIGN.md` 7절의 묶음 형식이다. `docs`의 키는 읽기 쉬운 **가짜 해시**(base62 12자)라서 해시 검증은 하지 않는다(SPEC 3.2절).
- `limits`는 생략하면 기본값(`maxDepth` 16, `maxExpansions` 10000).
- `runs`의 각 항목은 `text`(정확히 같은 문자열) 또는 `error`(오류 코드) 중 하나다.
- `covers`는 사례가 다루는 주제 표시다: `basic` `weights` `count` `sep` `no-replacement` `empty` `choice` `escape` `unicode` `numbering`
  `choice-weight` `ref-mine` `ref-item` `lock` `spread` `diamond` `repeat` `depth` `budget` `limits` `seed` `bundle` `syntax` `error` `cleanup` `realistic`.

### hash.json

- `base62`: 32바이트(16진수 64자) → 62진법 43자.
- `jcs`: JSON 원문 `input`을 직접 파싱해 정규화한 결과 `out`. 키 순서(UTF-16), 문자열 이스케이프, 정수값인 소수 표기를 다룬다.
- `hash`: 저장 형식(SPEC 3.3)을 통과하는 문서 원문 → `jcs`, `sha256`(16진수), `out`(해시 12자).
- `jcs` 값과 `base62`의 앞 5개는 손으로 썼다. 나머지는 `tools/hashvec.py --update`가 빈 값만 채운다.

## 도구 (`tools/`)

| 파일 | 내용 |
|---|---|
| `refmodel.py` | 명세 **참조 모델**. 기대 출력을 만들고 명세를 리허설하는 용도이며 노드의 본 구현이 아니다. 표준 라이브러리만 쓴다 |
| `check.py` | 세 파일을 참조 모델로 검사하고 `hash.json`을 `hashvec.py`로 검사한다. `--update`는 `primitives.json`의 `out`과 `expand/*.json`의 결과를 다시 채운다 |
| `hashvec.py` | 내용 해시(SPEC 7절)를 표준 라이브러리만으로 따로 계산한다. 참조 모델과 무관하다 |
| `primitives.ts` | `primitives.json`을 TS로 검사한다. 명세만 보고 참조 모델과 따로 짰다 |

```bash
python packages/core/conformance/tools/check.py
```

```bash
node packages/core/conformance/tools/primitives.ts
```

TS 쪽은 루트의 `npm test`가 이 파일들을 그대로 읽어 돌린다(`packages/core/test/conformance-*.test.ts`). SPEC 4.3 성질도 TS에서 같은 변형으로 검사한다(`test/properties.test.ts`).

`check.py`는 기대값 비교 외에 SPEC 4.3절의 성질도 모든 전개 사례에 대해 검사한다.

- 모든 문서의 항목 순서를 뒤집어도 결과가 같다.
- spread가 아닌 ref 항목을 인라인 참조 텍스트(`${w:…}`)로 바꿔도 결과가 같다.
- 모든 텍스트 끝에 글자를 덧붙여도 뽑기·선택 기록이 같다.
- 가중치를 적지 않은 모든 선택지 보기에 `1*`을 적어도 결과가 같다(성질 5, 보기 가중치 문법 이전과 결과가 같다는 뜻).

## 상태

- `syntax.json`의 기대 구문 트리는 손으로 썼고 참조 모델과 일치한다.
- `primitives.json`은 참조 모델(Python)과 별도 TS 구현이 일치한다.
- `expand/*.json`의 기대 출력은 참조 모델이 만든 것이고, **Phase 1 TS 전개기(`packages/core`)가 참조 모델 코드를 보지 않고 명세만으로 전부 통과해 확정됐다**(2026-11-03). 37~40은 Phase 1에 손으로 쓴 사례다(`docs/NOTES.md`). 41~45는 보기 가중치(Phase 3 뒤 추가): 42는 08의 기대 출력을 손으로 옮겼고, 41·43은 참조 모델이 채웠고, 44·45와 문법 사례 24개는 손으로 썼다. 46(spread 펼치기도 전개 횟수에 센다)은 Phase 4에 더했다. 기대값은 참조 모델로 내고, 상한 없이 전개하면 `z`가 나오는 seed만 `E_BUDGET`인 것을 확인했다(`docs/NOTES.md`).
- `hash.json`은 손으로 쓴 값, Python(`hashvec.py`), TS(`packages/core/src/hash.ts`)가 모두 일치한다.
- 기대값이 어긋나면 명세를 읽고 어느 쪽이 틀렸는지 가린 뒤, 명세나 테스트를 먼저 고친다.

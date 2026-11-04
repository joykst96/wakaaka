# fixtures

테스트와 시드에 쓸 예시 와일드카드의 재료와 생성기.

예시를 와일드카드 문서로 저장해 두면 스키마가 바뀔 때마다 고쳐야 한다. 그래서 **스키마와 무관한 태그 목록(CSV)만 저장**하고,
예시 와일드카드는 생성기가 현재 스키마로 그때그때 만든다.

| 경로 | 내용 | 커밋 |
|---|---|---|
| `materials/*.csv` | 분야별 태그 재료 33개 파일, 709줄. 출처와 규칙은 `materials/SOURCE.md` | 함 |
| `tools/slice_materials.py` | `danbooru-tags.csv`에서 재료를 다시 자른다 | 함 |
| `tools/build-examples.ts` | 재료로 예시 와일드카드 42개와 묶음을 만든다. **스키마가 바뀌면 이 파일을 고친다** | 함 |
| `tools/check_examples.py` | 만든 예시를 명세 참조 모델로 검사하고 묶음을 전개해 보여 준다 | 함 |
| `tools/build-defaults.ts` | 운영 기본 와일드카드(태그 CSV 전체에서 한글 설명이 있는 것, NSFW 여과 없음, DESIGN 10절)를 `out/defaults.json`으로. 재료 CSV를 쓰지 않는다 | 함 |
| `out/` | 생성 결과 `examples.json`, `bundles.json`, `escape-roundtrip.json` | 안 함 |

```bash
node fixtures/tools/build-examples.ts
```

```bash
python fixtures/tools/check_examples.py
```

## 만드는 예시

- 재료 하나 = 원자 와일드카드 하나(머리색, 상의, 장소 …). 가중치는 post_count의 제곱근 비율로 1~10.
- 조합 예시: `outfit`(ref 항목), `accessories`(spread, 0~3개), `location`(종류를 먼저 고름), `miku set`(선택지 안의 참조),
  `character pool`, `subject`, `scene preset`(전부 조합한 루트), `emoticon test`(이스케이프 검사).
- 와일드카드 ID는 이름에서, 항목 ID는 재료 태그 이름에서 해시로 만든다. 다시 만들어도 같은 seed는 같은 결과를 낸다.
- 묶음(`bundles.json`)의 해시 자리에는 와일드카드 ID를 그대로 쓴다. 전개기는 해시를 검증하지 않는다(SPEC 3.2).

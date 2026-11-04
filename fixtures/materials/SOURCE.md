# 재료 CSV 출처

예시 와일드카드를 만드는 재료다. 와일드카드 스키마와 무관한 태그 목록이라서, 스키마가 바뀌어도 그대로 쓴다.

| 항목 | 값 |
|---|---|
| 원본 | `danbooru-tags.csv` (별도 프로젝트 `danbooru-tag`의 산출물. Danbooru 태그와 한국어 설명) |
| 원본 형식 | 4열 `name,category,post_count,description`, 114,092행 |
| 원본 sha256 | `775b0abbad1fe75c9d9f8bc6bf8e516a368bd6c1f71dd78aa53798fe24cd671d` |
| 자른 날 | 2026-11-03 |
| 자른 도구 | `fixtures/tools/slice_materials.py` (`quality_manual.csv`는 손으로 씀) |

## 형식

모든 파일이 `name,posts,group,ko` 4열이다.

- `name`: Danbooru 원래 표기(밑줄 포함). 프롬프트 표기(공백, 괄호 이스케이프)는 `build-examples.ts`의 `promptTag`가 만든다.
- `posts`: 원본의 post_count. `quality_manual.csv`는 Danbooru 태그가 아니라서 비어 있다.
- `group`: 원본 설명 맨 앞 `[대분류 > 소분류]`의 소분류. `special.csv`는 `pipe/backslash`, `short-emoticon`, `parenthesis`.
- `ko`: 원본 설명의 "키워드:" 첫 단어.

## 고른 규칙

- 분야마다 원본의 소분류로 고르고 post_count 순으로 위에서 10~40개를 자른다. 목록은 `slice_materials.py`의 `SLICES`.
- 캐릭터(category 4) 40개, 작품(category 3) 20개, 메타 화질 태그 6개.
- `special.csv`: 와카아카 문법의 특수문자(세로선, 백슬래시)가 든 태그, 3자 이하 이모티콘, 괄호가 든 캐릭터 태그. 이스케이프와 표기 변환 검사용.
- 공개 테스트 서버에 올라가는 예시라서 성인 분류(성적행위, 속옷 등)를 고르지 않고, 이름·설명 키워드 필터와 검토 후 제외 목록(`EXCLUDE`)으로 걸렀다. 작가 태그는 넣지 않았다.

다시 자르면 원본이 바뀌었을 수 있으니 sha256을 새로 적는다. 원본은 6열(대분류·소분류 추가)로 바뀔 예정이며, 그때 `slice_materials.py`의 분류 읽기를 고친다.

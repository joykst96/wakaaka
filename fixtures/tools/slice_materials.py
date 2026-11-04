"""danbooru-tags.csv에서 분야별 재료 CSV를 잘라 fixtures/materials/에 쓴다.

    python slice_materials.py <danbooru-tags.csv 경로>

재료는 태그 이름(Danbooru 원래 표기) 목록일 뿐이고 와일드카드 스키마와 무관하다.
예시 와일드카드는 build-examples.ts가 재료로 그때그때 만든다.
원본의 설명 맨 앞 `[대분류 > 소분류]`로 고르고, post_count 순으로 위에서부터 자른다.
공개 테스트 서버에 올라가는 예시라서 성인 분류와 성인 태그는 뺀다.
"""

import csv
import hashlib
import os
import re
import sys

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "materials")
BRACKET = re.compile(r"^\[([^\]>]+?)\s*>\s*([^\]]+?)\]\s*(.*)$")
KEYWORDS = re.compile(r"키워드:\s*([^,]+)")

# (파일 이름, [(대분류, 소분류)], 개수). 소분류 None은 대분류 전체.
SLICES = [
    ("hair_color", [("머리카락", "머리 색상")], 20),
    ("hair_length", [("머리카락", "머리 길이")], 10),
    ("hair_style", [("머리카락", "헤어스타일")], 40),
    ("eye_color", [("얼굴/눈", "눈 색상")], 15),
    ("expression", [("표정/감정", "표정")], 40),
    ("gesture", [("표정/감정", "제스처")], 25),
    ("top", [("의상", "상의")], 30),
    ("bottom", [("의상", "하의")], 20),
    ("dress", [("의상", "원피스/드레스")], 20),
    ("uniform", [("의상", "교복")], 15),
    ("traditional", [("의상", "전통의상")], 15),
    ("headwear", [("액세서리", "모자"), ("액세서리", "머리장식")], 30),
    ("legwear", [("액세서리", "양말/스타킹")], 15),
    ("footwear", [("액세서리", "신발")], 15),
    ("eyewear", [("액세서리", "안경/아이웨어")], 10),
    ("jewelry", [("액세서리", "귀걸이/목걸이")], 15),
    ("pose", [("포즈/구도", "포즈")], 40),
    ("framing", [("포즈/구도", "프레이밍")], 15),
    ("angle", [("포즈/구도", "시점/앵글")], 15),
    ("action", [("행동", "일상행동")], 40),
    ("indoor", [("배경/장소", "실내")], 25),
    ("outdoor", [("배경/장소", "실외")], 15),
    ("nature", [("배경/장소", "자연")], 25),
    ("city", [("배경/장소", "도시")], 20),
    ("fantasy_place", [("배경/장소", "판타지")], 15),
    ("lighting", [("효과/연출", "조명")], 15),
    ("weather", [("효과/연출", "날씨")], 15),
    ("food", [("사물", "음식/음료")], 25),
    ("animal", [("동물/생물", "동물")], 20),
]
CHARACTERS = 40  # category 4
COPYRIGHTS = 20  # category 3
META = [("메타", "화질/해상도")]  # category 5에서

# 이름에 이 조각이 들어가면 뺀다(공개 예시용). 고른 소분류 자체가 일반적이라 대부분 걸리지 않는다.
BLOCK = [
    "nude", "naked", "sex", "nipple", "pussy", "penis", "cum", "breast", "ass", "panties", "pantsu", "bra", "underwear",
    "bdsm", "bondage", "spread", "ahegao", "torogao", "fellatio", "lingerie", "topless", "bottomless", "erect",
    "grope", "groping", "masturbat", "crotch", "cameltoe", "areola", "pubic", "anus", "vagina", "nsfw", "rape",
    "tentacle", "vore", "guro", "blood", "censor", "lactation", "orgasm", "saliva", "naughty", "seductive", "undress",
    "strip", "bikini", "lewd", "fetish", "upskirt", "pantyshot", "cleavage", "thong", "latex", "leash", "collar",
    "gag", "restrained", "tied", "kiss", "lick", "suck", "bed", "bath", "shower", "sweat", "drunk", "smoking",
    "cigarette", "gun", "knife", "weapon", "corpse", "death", "injury", "bandage", "tears", "crying",
]
BLOCK_KO = ["성적", "음란", "노출", "선정", "자위", "성기", "가슴을", "속옷", "알몸", "나체"]
# 위 필터를 통과했지만 결과를 보고 뺀 것(암시적이거나 예시로 쓸모없음). 2026-11-03 검토.
EXCLUDE = {
    "covering_privates", "straddling", "all_fours", "between_legs", "legs_apart", "legs_up", "bent_over",
    "drooling", "heavy_breathing", "holding_unworn_clothes", "pulling_own_clothes", "gym_storeroom",
    "garter_straps", "fishnets", "black_bodysuit", "unconventional_maid", "white_border", "solo_focus",
    "size_difference", "foot_focus", "wet", "torn_pantyhose", "fishnet_pantyhose", "hip_focus", "sandwiched",
}


def blocked(name, desc):
    n = name.lower()
    return name in EXCLUDE or any(b in n for b in BLOCK) or any(b in desc for b in BLOCK_KO)


def ko_label(desc):
    m = KEYWORDS.search(desc)
    return m.group(1).strip() if m else ""


def main(src):
    data = open(src, "rb").read()
    rows = list(csv.DictReader(data.decode("utf-8").splitlines()))
    parsed = []
    for r in rows:
        m = BRACKET.match(r["description"])
        major, minor = (m.group(1).strip(), m.group(2).strip()) if m else ("", "")
        parsed.append({"name": r["name"], "cat": r["category"], "posts": int(r["post_count"]),
                       "major": major, "minor": minor, "desc": r["description"]})
    parsed.sort(key=lambda x: (-x["posts"], x["name"]))
    os.makedirs(OUT, exist_ok=True)
    summary = []

    def write(fname, picked, group_of):
        path = os.path.join(OUT, fname + ".csv")
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["name", "posts", "group", "ko"])
            for x in picked:
                w.writerow([x["name"], x["posts"], group_of(x), ko_label(x["desc"])])
        summary.append((fname, len(picked)))
        print(f"{fname} ({len(picked)}): " + ", ".join(x["name"] for x in picked))

    def take(pred, n):
        return [x for x in parsed if pred(x) and not blocked(x["name"], x["desc"])][:n]

    for fname, sels, n in SLICES:
        picked = take(lambda x: x["cat"] == "0" and any(x["major"] == a and (b is None or x["minor"] == b) for a, b in sels), n)
        write(fname, picked, lambda x: x["minor"])
    write("character", take(lambda x: x["cat"] == "4", CHARACTERS), lambda x: x["minor"])
    write("copyright", take(lambda x: x["cat"] == "3", COPYRIGHTS), lambda x: x["minor"])
    write("meta_quality", take(lambda x: x["cat"] == "5" and (x["major"], x["minor"]) in META, 6), lambda x: x["minor"])

    # 우리 문법의 특수문자(| \)나 괄호, 짧은 이모티콘이 든 태그: 이스케이프와 표기 변환 검사용
    special = [x for x in parsed if x["cat"] == "0" and not blocked(x["name"], x["desc"])
               and (("|" in x["name"]) or ("\\" in x["name"]) or (len(x["name"]) <= 3 and "_" in x["name"]))][:20]
    paren = take(lambda x: x["cat"] == "4" and "(" in x["name"], 5)
    write("special", special + paren, lambda x: "pipe/backslash" if ("|" in x["name"] or "\\" in x["name"])
          else ("parenthesis" if "(" in x["name"] else "short-emoticon"))

    sha = hashlib.sha256(data).hexdigest()
    print(f"\nsource sha256 {sha}, rows {len(rows)}")
    print("total", sum(n for _, n in summary), "rows in", len(summary), "files")


if __name__ == "__main__":
    main(sys.argv[1])

// 고정 분류 (DESIGN 3절, 2026-11-03 확정). 저장 순서 = ID 1~13. 한 번 정한 ID는 바꾸지 않는다.
export const CATEGORIES: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "캐릭터·작품" },
  { id: 2, label: "작가·화풍" },
  { id: 3, label: "인물·관계" },
  { id: 4, label: "신체·머리카락" },
  { id: 5, label: "얼굴·표정" },
  { id: 6, label: "의복·장신구" },
  { id: 7, label: "행동·자세" },
  { id: 8, label: "사물" },
  { id: 9, label: "장소·배경" },
  { id: 10, label: "구도·시점" },
  { id: 11, label: "상황·주제" },
  { id: 12, label: "프리셋·조합" },
  { id: 13, label: "기타" },
];

export const categoryLabel = (id: number) => CATEGORIES.find((c) => c.id === id)?.label ?? String(id);

// 고정 배지 (DESIGN 11절 "고정 배지"): 결과가 늘 같은 와일드카드. 보라 원 안의 F.
// 화면 읽기에서는 "고정"으로 읽고, 마우스를 올리면 뜻을 보인다.

export const FIXED_TITLE = "고정: 결과가 늘 같습니다";

/** decorative: 옆 글자가 이미 "고정"을 말할 때(필터 칩). 화면 읽기에서 숨기고 툴팁도 달지 않는다 */
export function FixedBadge({ decorative = false }: { decorative?: boolean }) {
  if (decorative)
    return (
      <span className="fixed-badge" aria-hidden="true">
        F
      </span>
    );
  return (
    <span className="fixed-badge" title={FIXED_TITLE} role="img" aria-label="고정">
      F
    </span>
  );
}

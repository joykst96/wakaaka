// 기억한 테마를 첫 화면 전에 적용한다 (DESIGN 10절 "테마 전환 버튼"). CSP 때문에 인라인이 아니라 파일이다.
// 값이 없거나 이상하면 아무것도 하지 않는다(토큰 기본 동작: OS를 따른다). 읽는 규칙은 src/lib/theme.ts와 같다.
try {
  var t = localStorage.getItem("wakaaka:theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}

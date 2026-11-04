import { defineConfig } from "vitest/config";

// 웹 테스트는 DOM 없이 순수 함수(텍스트 보기, 이름 참조, 미리보기 묶음, 링크·출력 안전)를 본다.
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});

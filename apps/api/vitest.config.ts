import { defineConfig } from "vitest/config";

// 통합 테스트는 실제 Postgres에 테스트마다 스키마를 만든다. argon2id 해시도 실제 비용으로 돈다.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000, globalSetup: ["test/global-setup.ts"] },
});

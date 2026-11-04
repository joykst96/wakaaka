import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 개발: vite가 5173에서 웹을, /api는 로컬 API(3000)로 넘긴다. 배포: API 서버가 dist/를 서빙한다(DESIGN 10절).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  build: {
    outDir: "dist",
    // 소스 맵은 내보내지 않는다. 공개 서버라 받을 사람이 없고 배포물이 작아진다
    sourcemap: false,
  },
});

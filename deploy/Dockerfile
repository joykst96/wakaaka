# 와카아카 앱 이미지. 빌드 컨텍스트는 저장소 루트(테스트 서버에서는 ~/docker/wakaaka-test/src).
# 두 단계: (1) 웹만 vite build, (2) 실행 이미지. API는 빌드하지 않는다(Node 22가 .ts를 바로 돌린다, NOTES Phase 2).
# 웹 의존성(React, CodeMirror, vite)은 apps/web의 devDependencies라 실행 이미지의 npm ci --omit=dev에 들어가지 않는다.

# ---------------------------------------------------------------- 1. 웹 빌드
FROM node:22.23.3-alpine3.24 AS web

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY packages/core/src packages/core/src
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/
COPY apps/web/src apps/web/src
# public/은 vite가 dist/ 바로 아래로 그대로 복사한다(theme.js: 첫 화면 전 테마 적용, DESIGN 10절)
COPY apps/web/public apps/web/public
RUN npm run build -w @wakaaka/web

# ---------------------------------------------------------------- 2. 실행
FROM node:22.23.3-alpine3.24

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
ENV WEB_DIST=/app/apps/web/dist
# 시드 생성기와 재료 (test-reset.sh, 운영 기본 와일드카드는 prod-defaults.sh가 컨테이너 안에서 돌린다)
COPY fixtures/materials fixtures/materials
COPY fixtures/tools/build-examples.ts fixtures/tools/build-defaults.ts fixtures/tools/
RUN mkdir -p fixtures/out && chown node:node fixtures/out

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/api/src/server.ts"]

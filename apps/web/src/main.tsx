// 웹 진입점. zod 설정은 core가 스키마를 만들기 전에 평가되도록 맨 먼저 가져온다(zod-jitless.ts).
import "./zod-jitless.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./design-tokens/tokens.css";
import "./design-tokens/base.css";
import "./design-tokens/ui.css";
import "./styles/components.css";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// zod는 스키마를 만들 때 Function("")으로 eval 가능 여부를 본다. CSP default-src 'self'에서는 막혀 콘솔 오류가 남는다.
// 스키마를 만드는 core보다 먼저 평가되도록 main.tsx의 첫 import로 둔다(NOTES Phase 3 "CSP").
import { config } from "zod";

config({ jitless: true });

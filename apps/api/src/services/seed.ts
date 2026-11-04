// 예시 와일드카드 시드 (DESIGN 12절). fixtures/tools/build-examples.ts가 만든 examples.json을 일반 저장 경로로 넣는다.
// 예시의 ID는 생성기가 이름에서 만든 것이라, 서버가 새로 준 ID로 참조를 바꿔 쓴다(가져오기와 같은 rebuildDoc).

import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import * as owners from "../repositories/owners.ts";
import * as auth from "./auth.ts";
import { rebuildDoc } from "./docs.ts";
import { docRefs } from "./validate.ts";
import { createWildcard, type Owner } from "./wildcards.ts";

const examplesSchema = z.object({
  format: z.literal("wakaaka-examples/1"),
  owner: z.string(),
  wildcards: z.array(z.object({ id: z.string(), name: z.string(), categories: z.array(z.int()), doc: z.unknown() })),
});

/** 소유자가 없으면 만든다. 비밀번호는 무작위이고 어디에도 남기지 않는다(시드 계정으로는 로그인하지 않는다) */
async function seedOwner(db: Db, username: string): Promise<Owner> {
  const row = await owners.findOwnerForLogin(db, username);
  if (row) return { id: row.id, username: row.username };
  return (await auth.signup(db, username, randomBytes(24).toString("base64url"))).owner;
}

/** 예시를 의존 순서대로 저장하고 예시 이름 → 새 ID를 돌려준다 */
export async function seedExamples(db: Db, examples: unknown, username?: string): Promise<Map<string, string>> {
  const ex = examplesSchema.parse(examples);
  const owner = await seedOwner(db, username ?? ex.owner);
  const byId = new Map(ex.wildcards.map((w) => [w.id, w]));
  const map = new Map<string, string>(); // 예시 ID → 새 ID
  const names = new Map<string, string>();
  const visiting = new Set<string>();
  const visit = async (exId: string): Promise<string> => {
    const done = map.get(exId);
    if (done) return done;
    const w = byId.get(exId);
    if (!w) throw new Error(`example references unknown wildcard ${exId}`);
    if (visiting.has(exId)) throw new Error(`example cycle at ${w.name}`);
    visiting.add(exId);
    const parsed = rebuildDoc(w.doc, w.name, (id) => id); // 스키마 검사 겸 참조 목록
    for (const r of docRefs(parsed)) await visit(r.target);
    const doc = rebuildDoc(w.doc, w.name, (id) => map.get(id)!);
    const r = await createWildcard(db, owner, { doc, categories: w.categories });
    for (const warn of r.warnings) console.warn(`seed warning: ${w.name}: ${warn.code}`);
    map.set(exId, r.id);
    names.set(w.name, r.id);
    return r.id;
  };
  for (const w of ex.wildcards) await visit(w.id);
  return names;
}

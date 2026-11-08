// 관리 CLI의 인자 해석과 실행(DESIGN 9절 "관리"). 진입점은 admin.ts. 테스트가 이 함수를 바로 부른다.

import type { Db } from "./db/connect.ts";
import * as admin from "./services/admin.ts";

export const USAGE = `usage: node apps/api/src/admin.ts <command> [args] [--yes]
  show-wildcard <id>              와일드카드 정보, 함께 지워질 것, 남이 가져간 복사본
  show-account <username>         계정 정보와 와일드카드 목록(지운 것 포함)
  delete-wildcard <id>            강제 삭제. 같은 소유자의 참조하는 와일드카드도 함께 지운다
  delete-account <username>       계정 삭제. 와일드카드 전부, 세션·즐겨찾기·좋아요를 지운다(되살리기 없음)
  restore-wildcard <id> [<id>…]   지운 와일드카드 되살리기(함께 지운 것은 함께)
바꾸는 명령은 --yes가 없으면 할 일만 보여 준다(드라이런).`;

const COMMANDS: Record<string, { args: "one" | "many"; changes: boolean }> = {
  "show-wildcard": { args: "one", changes: false },
  "show-account": { args: "one", changes: false },
  "delete-wildcard": { args: "one", changes: true },
  "delete-account": { args: "one", changes: true },
  "restore-wildcard": { args: "many", changes: true },
};

export interface Parsed {
  command: string;
  args: string[];
  yes: boolean;
}

/** 모르는 명령·옵션, 인자 수가 틀리면 AdminError. 인자 형식(ID, 아이디)은 서비스가 검사한다 */
export function parseArgs(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") throw new admin.AdminError(USAGE);
  const spec = COMMANDS[command];
  if (!spec) throw new admin.AdminError(`unknown command: ${JSON.stringify(command)}\n${USAGE}`);
  let yes = false;
  const args: string[] = [];
  for (const a of rest) {
    if (a === "--yes") {
      if (!spec.changes) throw new admin.AdminError(`${command} does not change anything; --yes is not used`);
      yes = true;
    } else if (a.startsWith("-")) throw new admin.AdminError(`unknown option: ${JSON.stringify(a)}`);
    else args.push(a);
  }
  if (spec.args === "one" ? args.length !== 1 : args.length < 1) throw new admin.AdminError(`wrong number of arguments for ${command}\n${USAGE}`);
  return { command, args, yes };
}

const brief = (w: admin.WcBrief) => `  ${w.id}  ${w.name}  (${w.owner})`;

/** 결과를 out으로 쓴다. 거부는 AdminError로 던진다 */
export async function runAdmin(db: Db, argv: string[], out: (line: string) => void): Promise<void> {
  const p = parseArgs(argv);
  const dry = !p.yes;
  const tail = () => out(dry ? "dry run: nothing changed. add --yes to do it" : "done");
  switch (p.command) {
    case "show-wildcard": {
      const w = await admin.showWildcard(db, p.args[0]!);
      out(`${w.id}  ${w.name}  owner ${w.owner}  v${w.version}  likes ${w.likes}${w.forkedFrom ? `  copy of ${w.forkedFrom}` : ""}`);
      out(`created ${w.createdAt.toISOString()}${w.deletedAt ? `  DELETED ${w.deletedAt.toISOString()}` : ""}`);
      out(`referenced by (deleted together on delete-wildcard): ${w.dependents.length}`);
      for (const d of w.dependents) out(`  ${d.id}  ${d.name}  (depth ${d.depth})`);
      out(`copies by others (kept): ${w.copies.length}`);
      for (const c of w.copies) out(brief(c));
      return;
    }
    case "show-account": {
      const a = await admin.showAccount(db, p.args[0]!);
      out(`${a.username}  created ${a.createdAt.toISOString()}${a.deletedAt ? `  DELETED ${a.deletedAt.toISOString()}` : ""}  sessions ${a.sessions}`);
      out(`wildcards: ${a.wildcards.length}`);
      for (const w of a.wildcards) {
        out(`  ${w.id}  ${w.name}  v${w.latest_seq}  likes ${w.like_count}${w.forked_from_wildcard ? `  copy of ${w.forked_from_wildcard}` : ""}${w.deleted_at ? `  DELETED ${w.deleted_at.toISOString()}` : ""}`);
      }
      return;
    }
    case "delete-wildcard": {
      const r = await admin.deleteWildcard(db, p.args[0]!, p.yes);
      out(`${dry ? "would delete" : "deleted"} ${r.deleted.length}:`);
      for (const w of r.deleted) out(brief(w));
      out(`restore: node apps/api/src/admin.ts restore-wildcard ${r.deleted.map((w) => w.id).join(" ")} --yes`);
      tail();
      return;
    }
    case "delete-account": {
      const r = await admin.deleteAccount(db, p.args[0]!, p.yes);
      out(`${dry ? "would delete" : "deleted"} account ${r.username}: wildcards ${r.wildcards}, sessions ${r.sessions}, favorites ${r.favorites}, likes given ${r.likes}, folders ${r.folders}`);
      tail();
      return;
    }
    case "restore-wildcard": {
      const r = await admin.restoreWildcards(db, p.args, p.yes);
      out(`${dry ? "would restore" : "restored"} ${r.restored.length}:`);
      for (const w of r.restored) out(brief(w));
      tail();
      return;
    }
  }
}

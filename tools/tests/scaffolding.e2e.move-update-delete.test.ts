#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("move, update, delete and ls reflects state", async () => {
  await runInTemp("scaf-e2e", async (_tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    await $`git init`;
    await $`git add -A`;
    await $`git commit -m "init scaffold"`;
    await $`scaf move libs/demo-lib libs/demo-moved --yes`;
    await $`git add -A`;
    await $`git commit -m "move scaffold"`;
    const ans = path.join(_tmp, "libs", "demo-moved", ".copier-answers.yml");
    const txt = await fsp.readFile(ans, "utf8");
    if (!/^name:\s*demo-moved/m.test(txt)) {
      console.error("move did not update name in .copier-answers.yml");
      process.exit(2);
    }
    await $`scaf update libs/demo-moved --dry-run`;
    let prompted = false;
    try {
      await $`scaf update libs/demo-moved`;
    } catch {
      prompted = true;
    }
    if (!prompted) {
      console.error("expected update without --yes to abort");
      process.exit(2);
    }
    await $`scaf update libs/demo-moved --yes`;
    await $`scaf delete libs/demo-moved --dry-run`;
    await $`scaf delete libs/demo-moved --yes`;
    const res = await pipe$`scaf ls --json`;
    const arr = JSON.parse(res.stdout.trim() || "[]");
    if (arr.some((r: any) => String(r.path || "").endsWith("libs/demo-moved"))) {
      console.error("delete failed: libs/demo-moved still listed");
      process.exit(2);
    }
  });
});

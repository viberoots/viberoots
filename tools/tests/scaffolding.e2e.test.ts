#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { runInTemp } from "./lib/test-helpers";

test("new overwrite guard requires --yes or supports --dry-run", async () => {
  await runInTemp("scaf-overwrite-guard", async (_tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    let prompted = false;
    try {
      await $`scaf new go lib demo-lib`;
    } catch {
      prompted = true;
    }
    if (!prompted) {
      console.error("expected new without --yes to abort on non-empty dir");
      process.exit(2);
    }
    await $`scaf new go lib demo-lib --dry-run`;
    await $`scaf new go lib demo-lib --yes`;
  });
});

test("regen staging restores original on failure", async () => {
  await runInTemp("scaf-regen-stage", async (tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    const answers = path.join(tmp, "libs", "demo-lib", ".copier-answers.yml");
    let txt = await fsp.readFile(answers, "utf8").catch(() => "");
    txt = txt.replace(
      /^scaf_src_path:.*/m,
      "scaf_src_path: tools/scaffolding/templates/does/not/exist",
    );
    await fsp.writeFile(answers, txt, "utf8");
    const readme = path.join(tmp, "libs", "demo-lib", "README.md");
    const marker = "RESTORE_ME";
    await fsp.appendFile(readme, `\n${marker}\n`, "utf8");
    let failed = false;
    try {
      await pipe$`scaf regen libs/demo-lib --yes`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected regen to fail with bad source");
      process.exit(2);
    }
    const content = await fsp.readFile(readme, "utf8");
    if (!content.includes(marker)) {
      console.error("regen did not restore original content from staging");
      process.exit(2);
    }
  });
});

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

test("move requires confirmation unless --yes", async () => {
  await runInTemp("scaf-move-confirm", async (_tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    let prompted = false;
    try {
      await pipe$`scaf move libs/demo-lib libs/demo-moved`;
    } catch {
      prompted = true;
    }
    if (!prompted) {
      console.error("expected move without --yes to abort");
      process.exit(2);
    }
    await $`scaf move libs/demo-lib libs/demo-moved --yes`;
  });
});

test("meta.json help validation pass/fail scenarios", async () => {
  await runInTemp("tmpl-validate-pass", async (_tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    await $`scaf validate all --quiet`;
  });
  await runInTemp("tmpl-validate-fail1", async (tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const metaPath = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    delete (meta as any).help;
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    let failed = false;
    try {
      await $`scaf validate tools/scaffolding/templates/go/lib --quiet`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("validator unexpectedly passed");
      process.exit(2);
    }
  });
  await runInTemp("tmpl-validate-fail2", async (tmp, _$) => {
    process.env.JSON_CLI_SKIP_DIRENV = "1";
    const $ = _$({ stdio: "ignore" });
    const metaPath = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    (meta as any).help = { usage: "" };
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    let failed = false;
    try {
      await $`scaf validate tools/scaffolding/templates/go/lib --quiet`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("validator unexpectedly passed");
      process.exit(2);
    }
  });
});

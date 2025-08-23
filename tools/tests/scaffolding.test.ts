#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { runInTemp } from "./lib/test-helpers";

describe("scaffolding", () => {
  test("buck2 config uses TARGETS buildfile", async () => {
    await runInTemp("buck2-targets", async (tmp, _$) => {
      const cfg = await fsp.readFile(path.join(tmp, ".buckconfig"), "utf8");
      if (!/\[buildfile\][\s\S]*?name\s*=\s*TARGETS/m.test(cfg)) {
        console.error("Expected .buckconfig to include buildfile.name = TARGETS");
        process.exit(2);
      }
    });
  });

  test("scaf new go lib <name> renders README", async () => {
    await runInTemp("scaf-smoke", async (tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const pipe$ = _$({ stdio: "pipe" });

      const name = "demo-lib";
      const dest = path.join(tmp, "libs", name);
      try {
        await pipe$`scaf new go lib ${name}`;
      } catch (e: any) {
        const out = e?.stdout || "";
        const err = e?.stderr || "";
        console.error("scaf new failed:\n" + (err || out));
        process.exit(2);
      }
      const readme = path.join(dest, "README.md");
      const existsReadme = await fsp
        .access(readme)
        .then(() => true)
        .catch(() => false);
      if (!existsReadme) {
        console.error("README.md missing in scaffold");
        process.exit(2);
      }
      const content = await fsp.readFile(readme, "utf8");
      if (!content.startsWith(`# ${name} (Go library)`)) {
        console.error("README header mismatch");
        process.exit(2);
      }
    });
  });

  test("move, update, delete and ls reflects state", async () => {
    await runInTemp("scaf-e2e", async (_tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const pipe$ = _$({ stdio: "pipe" });

      await $`scaf new go lib demo-lib`;
      await $`git init`;
      await $`git add -A`;
      await $`git commit -m "init scaffold"`;
      await $`scaf move libs/demo-lib libs/demo-moved --yes`;
      await $`git add -A`;
      await $`git commit -m "move scaffold"`;
      await $`scaf update libs/demo-moved`;
      await $`scaf delete libs/demo-moved --yes`;
      const res = await pipe$`scaf ls --json`;
      const arr = JSON.parse(res.stdout.trim() || "[]");
      if (arr.some((r: any) => String(r.path || "").endsWith("libs/demo-moved"))) {
        console.error("delete failed: libs/demo-moved still listed");
        process.exit(2);
      }
    });
  });

  test("meta.json and help.md validation pass/fail scenarios", async () => {
    // pass
    await runInTemp("tmpl-validate-pass", async (_tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      await $`scaf validate all --quiet`;
    });
    // fail missing help.md
    await runInTemp("tmpl-validate-fail1", async (tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const bad = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "help.md");
      await fsp.rm(bad, { force: true });
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
    // fail meta.help present
    await runInTemp("tmpl-validate-fail2", async (tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const metaPath = path.join(
        tmp,
        "tools",
        "scaffolding",
        "templates",
        "go",
        "lib",
        "meta.json",
      );
      const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
      (meta as any).help = { usage: "bogus" };
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
});

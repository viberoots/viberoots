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

  test("scaf new go cli <name> renders README", async () => {
    await runInTemp("scaf-cli-smoke", async (tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const pipe$ = _$({ stdio: "pipe" });

      const name = "demo-cli";
      const dest = path.join(tmp, name);
      try {
        await pipe$`scaf new go cli ${name} --yes`;
      } catch (e: any) {
        const out = e?.stdout || "";
        const err = e?.stderr || "";
        console.error("scaf new (cli) failed:\n" + (err || out));
        process.exit(2);
      }
      const readme = path.join(dest, "README.md");
      const existsReadme = await fsp
        .access(readme)
        .then(() => true)
        .catch(() => false);
      if (!existsReadme) {
        console.error("README.md missing in CLI scaffold");
        process.exit(2);
      }
      const content = await fsp.readFile(readme, "utf8");
      if (!content.startsWith(`# ${name} (Go CLI)`)) {
        console.error("CLI README header mismatch");
        process.exit(2);
      }
    });
  });

  test("help --json includes variables from copier.yaml", async () => {
    await runInTemp("scaf-help-json", async (_tmp, _$) => {
      const pipe$ = _$({ stdio: "pipe" });
      const res = await pipe$`scaf help go lib --json`;
      const obj = JSON.parse(res.stdout.trim());
      if (!Array.isArray(obj.variables) || !obj.variables.includes("name")) {
        console.error("expected help --json to include variables");
        process.exit(2);
      }
    });
  });

  test("templates --json includes variables per template", async () => {
    await runInTemp("scaf-templates-json", async (_tmp, _$) => {
      const pipe$ = _$({ stdio: "pipe" });
      const res = await pipe$`scaf templates --json`;
      const arr = JSON.parse(res.stdout.trim());
      if (!Array.isArray(arr) || arr.length === 0) {
        console.error("expected templates array");
        process.exit(2);
      }
      const lib = arr.find((x: any) => x.language === "go" && x.template === "lib");
      if (!lib || !Array.isArray(lib.variables) || !lib.variables.includes("name")) {
        console.error("expected variables for go/lib to include 'name'");
        process.exit(2);
      }
    });
  });

  test("new overwrite guard requires --yes or supports --dry-run", async () => {
    await runInTemp("scaf-overwrite-guard", async (_tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const pipe$ = _$({ stdio: "pipe" });
      // first creation
      await $`scaf new go lib demo-lib`;
      // attempt to create again should prompt and exit 2
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
      // dry-run should exit 0
      await $`scaf new go lib demo-lib --dry-run`;
      // with --yes should proceed
      await $`scaf new go lib demo-lib --yes`;
    });
  });

  test("regen staging restores original on failure", async () => {
    await runInTemp("scaf-regen-stage", async (tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      const pipe$ = _$({ stdio: "pipe" });
      // create scaffold
      await $`scaf new go lib demo-lib`;
      // corrupt recorded source so staged regen tries and fails
      const answers = path.join(tmp, "libs", "demo-lib", ".copier-answers.yml");
      let txt = await fsp.readFile(answers, "utf8").catch(() => "");
      txt = txt.replace(
        /^scaf_src_path:.*/m,
        "scaf_src_path: tools/scaffolding/templates/does/not/exist",
      );
      await fsp.writeFile(answers, txt, "utf8");
      // Modify a file in the scaffold to detect restoration
      const readme = path.join(tmp, "libs", "demo-lib", "README.md");
      const marker = "RESTORE_ME";
      await fsp.appendFile(readme, `\n${marker}\n`, "utf8");
      // Run regen, expecting failure
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
      // Ensure staged restore retained our marker
      const content = await fsp.readFile(readme, "utf8");
      if (!content.includes(marker)) {
        console.error("regen did not restore original content from staging");
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
      // verify .copier-answers.yml name updated
      const ans = path.join(_tmp, "libs", "demo-moved", ".copier-answers.yml");
      const txt = await fsp.readFile(ans, "utf8");
      if (!/^name:\s*demo-moved/m.test(txt)) {
        console.error("move did not update name in .copier-answers.yml");
        process.exit(2);
      }
      // dry-run should not change state and should exit 0
      await $`scaf update libs/demo-moved --dry-run`;
      // without --yes, update should prompt and exit 2
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
      // dry-run delete
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

  test("meta.json help validation pass/fail scenarios", async () => {
    // pass
    await runInTemp("tmpl-validate-pass", async (_tmp, _$) => {
      const $ = _$({ stdio: "ignore" });
      await $`scaf validate all --quiet`;
    });
    // fail missing help object in meta.json
    await runInTemp("tmpl-validate-fail1", async (tmp, _$) => {
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
    // fail wrong type in meta.help
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
});

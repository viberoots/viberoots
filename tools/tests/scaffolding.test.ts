#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { $ } from "zx";
import { exists, mktemp, rsyncRepoTo } from "./lib/test-helpers";

async function runInTemp<T>(name: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await mktemp(name + "-");
  await rsyncRepoTo(tmp);
  try {
    return await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

describe("scaffolding", () => {
  test("buck2 config uses TARGETS buildfile", async () => {
    await runInTemp("buck2-targets", async (tmp) => {
      const cfg = await fsp.readFile(path.join(tmp, ".buckconfig"), "utf8");
      assert.match(cfg, /\[buildfile\][\s\S]*?name\s*=\s*TARGETS/m);
    });
  });

  test("scaf new go lib <name> renders README", async () => {
    await runInTemp("scaf-smoke", async (tmp) => {
      const name = "demo-lib";
      const dest = path.join(tmp, "libs", name);
      await $({ cwd: tmp, stdio: "ignore" })`scaf new go lib ${name}`;
      const readme = path.join(dest, "README.md");
      assert.ok(await exists(readme), "README.md should exist");
      const content = await fsp.readFile(readme, "utf8");
      assert.ok(content.startsWith(`# ${name} (Go library)`), "README header should match");
    });
  });

  test("move, update, delete and ls reflects state", async () => {
    await runInTemp("scaf-e2e", async (tmp) => {
      await $({ cwd: tmp, stdio: "ignore" })`scaf new go lib demo-lib`;
      await $({ cwd: tmp, stdio: "ignore" })`git init`;
      await $({ cwd: tmp, stdio: "ignore" })`git add -A`;
      await $({ cwd: tmp, stdio: "ignore" })`git commit -m "init scaffold"`;
      await $({ cwd: tmp, stdio: "ignore" })`scaf move libs/demo-lib libs/demo-moved --yes`;
      await $({ cwd: tmp, stdio: "ignore" })`git add -A`;
      await $({ cwd: tmp, stdio: "ignore" })`git commit -m "move scaffold"`;
      await $({ cwd: tmp, stdio: "ignore" })`scaf update libs/demo-moved`;
      await $({ cwd: tmp, stdio: "ignore" })`scaf delete libs/demo-moved --yes`;
      const res = await $({ stdio: "pipe", cwd: tmp })`scaf ls --json`;
      const arr = JSON.parse(res.stdout.trim() || "[]");
      assert.equal(
        arr.some((r: any) => String(r.path || "").endsWith("libs/demo-moved")),
        false,
      );
    });
  });

  test("meta.json and help.md validation pass/fail scenarios", async () => {
    // pass
    await runInTemp("tmpl-validate-pass", async (tmp) => {
      await $({ cwd: tmp, stdio: "ignore" })`scaf validate all --quiet`;
    });
    // fail missing help.md
    await runInTemp("tmpl-validate-fail1", async (tmp) => {
      const bad = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "help.md");
      await fsp.rm(bad, { force: true });
      let failed = false;
      try {
        await $({
          cwd: tmp,
          stdio: "ignore",
        })`scaf validate tools/scaffolding/templates/go/lib --quiet`;
      } catch {
        failed = true;
      }
      assert.ok(failed, "validator should fail when help.md is missing");
    });
    // fail meta.help present
    await runInTemp("tmpl-validate-fail2", async (tmp) => {
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
      meta.help = { usage: "bogus" };
      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
      let failed = false;
      try {
        await $({
          cwd: tmp,
          stdio: "ignore",
        })`scaf validate tools/scaffolding/templates/go/lib --quiet`;
      } catch {
        failed = true;
      }
      assert.ok(failed, "validator should fail when meta.help exists");
    });
  });
});

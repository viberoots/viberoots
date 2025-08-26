#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { runInTemp } from "./lib/test-helpers";

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

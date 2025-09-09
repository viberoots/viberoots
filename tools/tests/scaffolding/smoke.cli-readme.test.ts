#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("regen staging restores original on failure", async () => {
  await runInTemp("scaf-regen-stage", async (tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    const answers = path.join(tmp, "libs", "demo-lib", ".copier-answers.yml");
    let txt = await fsp.readFile(answers, "utf8").catch(() => "");
    txt = txt.replace(
      /^scaf_src_path:.*/m,
      "scaf_src_path: build-tools/tools/scaffolding/templates/does/not/exist",
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

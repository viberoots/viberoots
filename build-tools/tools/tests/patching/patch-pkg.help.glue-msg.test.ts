#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { patchPkgUsageNotes } from "../../lib/lang-contracts.ts";
import { runInTemp } from "../lib/test-helpers";

test("patch-pkg usage mentions Node and Python glue behavior consistently", async () => {
  await runInTemp("patch-pkg-help-glue-msg", async (tmp, $) => {
    await $`chmod +x build-tools/tools/bin/patch-pkg`;
    const out = await $({ cwd: tmp, stdio: "pipe" })`build-tools/tools/bin/patch-pkg`.nothrow();
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (out.exitCode === 0) {
      console.error("expected non-zero exit for usage output");
      process.exit(2);
    }
    if (!all.includes("Node and Python remain importer-scoped")) {
      console.error("expected Node+Python glue note missing from usage output");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }

    for (const note of patchPkgUsageNotes()) {
      if (!all.includes(note)) {
        console.error("expected contract-derived note missing from usage output:", note);
        console.error("--- captured output ---\n" + all + "\n--- end ---");
        process.exit(2);
      }
    }
  });
});

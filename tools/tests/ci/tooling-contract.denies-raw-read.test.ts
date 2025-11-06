#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("tooling-contract gate denies direct raw graph.json reads", async () => {
  await runInTemp("tooling-contract-deny", async (tmp, $) => {
    // Create a forbidden script that reads tools/buck/graph.json directly
    const badDir = path.join(tmp, "tools", "scripts");
    await fs.mkdirp(badDir);
    const badFile = path.join(badDir, "read-raw-graph.ts");
    await fs.writeFile(
      badFile,
      [
        "import fs from 'fs-extra';",
        "async function main(){",
        "  await fs.readFile('tools/buck/graph.json', 'utf8');",
        "}",
        "main().catch(()=>{});",
        "",
      ].join("\n"),
      "utf8",
    );

    // Run the gate and expect failure
    const fail = await $({ cwd: tmp })`node tools/ci/tooling-contract-check.ts`.nothrow();
    if (fail.exitCode === 0) {
      console.error("expected tooling-contract to fail when a raw read is present");
      process.exit(2);
    }

    // Remove the offender and expect success
    await fs.remove(badFile);
    const ok = await $({ cwd: tmp })`node tools/ci/tooling-contract-check.ts`.nothrow();
    if (ok.exitCode !== 0) {
      console.error("expected tooling-contract to succeed after removing raw read");
      process.exit(2);
    }
  });
});

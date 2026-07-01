#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("tooling-contract gate denies direct raw graph.json reads", async () => {
  await runInTemp("tooling-contract-deny", async (tmp, $) => {
    // Create a forbidden script that reads viberoots/build-tools/tools/buck/graph.json directly
    const badDir = path.join(tmp, "viberoots", "build-tools", "tools", "scripts");
    await fs.mkdirp(badDir);
    const badFile = path.join(badDir, "read-raw-graph.ts");
    await fs.writeFile(
      badFile,
      [
        "import fs from 'fs-extra';",
        "async function main(){",
        "  await fs.readFile('viberoots/build-tools/tools/buck/graph.json', 'utf8');",
        "}",
        "main().catch(()=>{});",
        "",
      ].join("\n"),
      "utf8",
    );

    // Run the gate and expect failure
    const fail = await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/ci/tooling-contract-check.ts`.nothrow();
    if (fail.exitCode === 0) {
      console.error("expected tooling-contract to fail when a raw read is present");
      process.exit(2);
    }

    // Remove the offender and expect success
    await fs.remove(badFile);
    const ok = await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/ci/tooling-contract-check.ts`.nothrow();
    if (ok.exitCode !== 0) {
      console.error("expected tooling-contract to succeed after removing raw read");
      process.exit(2);
    }
  });
});

test("tooling-contract gate denies deployment raw workspace graph access", async () => {
  await runInTemp("tooling-contract-deployment-deny", async (tmp, $) => {
    const badDir = path.join(tmp, "viberoots", "build-tools", "tools", "deployments");
    await fs.mkdirp(badDir);
    const directRead = path.join(badDir, "bad-resource-graph.ts");
    await fs.writeFile(
      directRead,
      [
        "import fs from 'fs-extra';",
        "export async function bad(){",
        "  return fs.readFile('.viberoots/workspace/buck/graph.json', 'utf8');",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const failDirect = await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/ci/tooling-contract-check.ts`.nothrow();
    if (failDirect.exitCode === 0) {
      console.error("expected tooling-contract to fail on raw workspace graph read");
      process.exit(2);
    }

    await fs.remove(directRead);
    await fs.writeFile(
      path.join(badDir, "bad-default-graph.ts"),
      [
        'import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";',
        "export const graphPath = DEFAULT_GRAPH_PATH;",
        "",
      ].join("\n"),
      "utf8",
    );
    const failConstant = await $({
      cwd: tmp,
    })`node viberoots/build-tools/tools/ci/tooling-contract-check.ts`.nothrow();
    if (failConstant.exitCode === 0) {
      console.error("expected tooling-contract to fail on deployment DEFAULT_GRAPH_PATH import");
      process.exit(2);
    }
  });
});

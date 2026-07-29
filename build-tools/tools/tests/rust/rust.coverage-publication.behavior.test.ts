#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCoverageC8 } from "../../dev/verify/coverage";
import { publishMergedLcovReport } from "../../dev/verify/coverage-lcov-report";
import { runInTemp } from "../lib/test-helpers";

test("merged LCOV publishes Rust data into summary JSON and HTML", async () => {
  await runInTemp("rust-coverage-publication", async (tmp) => {
    const coverage = path.join(tmp, "coverage");
    await fs.mkdir(coverage);
    await fs.writeFile(
      path.join(coverage, "lcov.info"),
      `TN:
SF:${tmp}/build-tools/tool.ts
FN:1,tool
FNDA:1,tool
DA:1,1
end_of_record
TN:
SF:${tmp}/projects/libs/rust_demo/src/lib.rs
FN:1,_RNv_demo
FNDA:1,_RNv_demo
DA:1,1
DA:2,0
BRDA:1,0,0,1
BRDA:1,0,1,0
end_of_record
`,
    );
    await publishMergedLcovReport(tmp);
    const summary = JSON.parse(
      await fs.readFile(path.join(coverage, "coverage-summary.json"), "utf8"),
    );
    const rustFile = `${tmp}/projects/libs/rust_demo/src/lib.rs`;
    assert.equal(summary[rustFile].lines.total, 2);
    assert.equal(summary[rustFile].lines.covered, 1);
    assert.equal(summary.total.lines.total, 3);
    const html = await fs.readFile(path.join(coverage, "index.html"), "utf8");
    assert.match(html, /projects\/libs\/rust_demo\/src\/lib\.rs/);
    assert.match(html, /Merged coverage/);

    const rustOnlyConsumer = path.join(tmp, "rust-only-consumer");
    await fs.mkdir(rustOnlyConsumer);
    const managedC8 = await resolveCoverageC8(rustOnlyConsumer);
    assert.match(managedC8 || "", /^\/nix\/store\/.*\/c8\/bin\/c8\.js$/);
  });
});

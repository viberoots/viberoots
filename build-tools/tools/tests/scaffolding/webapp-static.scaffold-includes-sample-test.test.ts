#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("webapp-static: scaffold includes a sample Vitest test", async () => {
  await runInTemp("webapp-static-sample-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;
    await $`scaf new ts webapp-static demo-web --yes --skip-lockfile-gen`;

    const sampleTest = path.join(
      tmp,
      "projects",
      "apps",
      "demo-web",
      "test",
      "wasm-contract.test.ts",
    );
    if (!(await exists(sampleTest))) {
      throw new Error(`expected sample test file to exist after scaffold: ${sampleTest}`);
    }
  });
});

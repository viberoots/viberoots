#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("webapp-ssr-vite: scaffold includes a sample Vitest test", async () => {
  await runInTemp("webapp-ssr-vite-sample-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;
    await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --skip-lockfile-gen`;

    const sampleTest = path.join(
      tmp,
      "projects",
      "apps",
      "demo-vite-ssr",
      "test",
      "entry-server.test.ts",
    );
    if (!(await exists(sampleTest))) {
      throw new Error(`expected sample test file to exist after scaffold: ${sampleTest}`);
    }
  });
});

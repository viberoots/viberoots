#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node cli scaffold: renders and help runs", async () => {
  await runInTemp("node-cli-scaffold-help", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    // Skip lockfile generation: this is a pure scaffold smoke test (template + runtime entrypoint).
    // Lockfile generation is covered by dedicated scaffold lockfile tests and build-path tests.
    await $`scaf new node cli demo --yes --skip-lockfile-gen`;
    await $({ cwd: path.join(tmp, "apps", "demo") })`node bin/demo --help`;
  });
});

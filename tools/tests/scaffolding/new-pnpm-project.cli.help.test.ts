#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node cli scaffold: renders and help runs", async () => {
  await runInTemp("node-cli-scaffold-help", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new node cli demo --yes`;
    await $({ cwd: path.join(tmp, "apps", "demo") })`node bin/demo --help`;
  });
});

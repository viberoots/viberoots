#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

test("node go-addon: scaffold writes pnpm-lock.yaml for importer-scoped wiring", async () => {
  await runInTemp("node-go-addon-scaffold-lockfile", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;
    await $`scaf new node go-addon demo --yes`;
    const lf = path.join(tmp, "libs", "demo", "pnpm-lock.yaml");
    if (!(await exists(lf))) {
      throw new Error(`expected pnpm-lock.yaml to exist after scaffold: ${lf}`);
    }
  });
});

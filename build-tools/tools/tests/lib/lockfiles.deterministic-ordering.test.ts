#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findPnpmLockfiles } from "../../lib/lockfiles";

test("lockfiles: deterministic sorted ordering", async () => {
  await runInTemp("lockfiles-order", async (tmp, $) => {
    process.chdir(tmp);
    const mk = async (p: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "lockfileVersion: '9.0'\nimporters: {}\npackages: {}", "utf8");
    };
    await $`git init`;
    await mk(path.join(tmp, "libs/x/pnpm-lock.yaml"));
    await mk(path.join(tmp, "apps/z/pnpm-lock.yaml"));
    await mk(path.join(tmp, "apps/a/pnpm-lock.yaml"));
    await $`git add -A`;
    const found = await findPnpmLockfiles({ roots: ["apps", "libs"] });
    const expected = ["apps/a/pnpm-lock.yaml", "apps/z/pnpm-lock.yaml", "libs/x/pnpm-lock.yaml"];
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      console.error("expected", expected, "got:", found);
      process.exit(2);
    }
  });
});

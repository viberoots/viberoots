#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findPnpmLockfiles } from "../../lib/lockfiles";

test("lockfiles: multiple roots discovery", async () => {
  await runInTemp("lockfiles-roots", async (tmp, $) => {
    process.chdir(tmp);
    const mk = async (p: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "lockfileVersion: '9.0'\nimporters: {}\npackages: {}", "utf8");
    };
    await $`git init`;
    const lfA = path.join(tmp, "apps/a/pnpm-lock.yaml");
    const lfL = path.join(tmp, "libs/x/pnpm-lock.yaml");
    await mk(lfA);
    await mk(lfL);
    await $`git add -A`;

    const all = await findPnpmLockfiles({ roots: ["apps", "libs"] });
    const onlyApps = await findPnpmLockfiles({ roots: ["apps"] });

    const expAll = ["apps/a/pnpm-lock.yaml", "libs/x/pnpm-lock.yaml"];
    if (JSON.stringify(all) !== JSON.stringify(expAll)) {
      console.error("expected", expAll, "got:", all);
      process.exit(2);
    }
    if (JSON.stringify(onlyApps) !== JSON.stringify(["apps/a/pnpm-lock.yaml"])) {
      console.error("expected only apps/a lockfile, got:", onlyApps);
      process.exit(2);
    }
  });
});

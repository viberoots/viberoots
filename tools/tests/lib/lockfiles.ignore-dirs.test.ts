#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { findPnpmLockfiles } from "../../lib/lockfiles.ts";

test("lockfiles: ignores standard directories", async () => {
  await runInTemp("lockfiles-ignores", async (tmp, $) => {
    process.chdir(tmp);
    const mk = async (p: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "lockfileVersion: '9.0'\nimporters: {}\npackages: {}", "utf8");
    };
    await $`git init`;
    // Ignored locations
    await mk(path.join(tmp, "apps/web/node_modules/foo/pnpm-lock.yaml"));
    await mk(path.join(tmp, "apps/web/.pnpm-store/pnpm-lock.yaml"));
    await mk(path.join(tmp, "apps/web/.clinic/pnpm-lock.yaml"));
    await mk(path.join(tmp, "apps/web/coverage/pnpm-lock.yaml"));
    await mk(path.join(tmp, "buck-out/scratch/pnpm-lock.yaml"));
    // Legitimate location
    const keep = path.join(tmp, "apps/web/pnpm-lock.yaml");
    await mk(keep);
    await $`git add -A`;
    const found = await findPnpmLockfiles({ roots: ["apps"] });
    const relKeep = "apps/web/pnpm-lock.yaml";
    if (found.length !== 1 || found[0] !== relKeep) {
      console.error("expected only", relKeep, "got:", found);
      process.exit(2);
    }
  });
});

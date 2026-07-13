#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash logs native fixed reconciliation progress", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("step=fixed-reconcile")) {
    throw new Error("update-pnpm-hash.ts must log fixed reconciliation phase");
  }
  if (!txt.includes("withPnpmStoreBuildFlakeRef")) {
    throw new Error("update-pnpm-hash.ts must recreate filtered inputs around native builds");
  }
  if (/unfixed-build|exact-store-(fetch|import)/.test(txt)) {
    throw new Error("update-pnpm-hash.ts must not log retired external reconciliation phases");
  }
});

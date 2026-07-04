#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps reports quiet node_modules progress during long child work", async () => {
  const depsMain = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/deps-main.ts",
    "utf8",
  );
  const progress = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/progress.ts",
    "utf8",
  );
  if (!depsMain.includes('import { withInstallProgress } from "./progress"')) {
    throw new Error("deps-main.ts must use the shared quiet child progress helper");
  }
  if (!progress.includes("export async function withInstallProgress")) {
    throw new Error("progress.ts must centralize quiet child progress reporting");
  }
  if (!progress.includes("[install-deps] waiting on")) {
    throw new Error("progress.ts must print an install progress heartbeat");
  }
  if (!progress.includes("output=quiet-unless-failed")) {
    throw new Error("install progress heartbeat must explain suppressed child output");
  }
  for (const label of ["update-pnpm-hash", "link-node"]) {
    if (!depsMain.includes(`node_modules \${imp} ${label}`)) {
      throw new Error(`deps-main.ts must report progress while ${label} runs`);
    }
  }
});

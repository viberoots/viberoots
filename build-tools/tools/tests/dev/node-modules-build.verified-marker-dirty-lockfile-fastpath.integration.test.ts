#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-modules-build reuses verified markers even when temp lockfiles are git-dirty", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/node-modules-build.ts", "utf8");
  if (!txt.includes("await requireFreshPnpmStoreState(relLock)")) {
    throw new Error("node-modules-build.ts must require verified pnpm-store state before building");
  }
  if (txt.includes("if (!dirty && (await hasFreshVerifiedMarker(lockfileRel))) return;")) {
    throw new Error(
      "node-modules-build.ts must not require a clean git lockfile before using a verified marker fast path",
    );
  }
  if (txt.includes("update-pnpm-hash.ts") || txt.includes("runPnpmHashUpdater")) {
    throw new Error("node-modules-build.ts must not invoke update-pnpm-hash from build paths");
  }
  if (!txt.includes("run `i` to refresh pnpm hashes and prewarm exact pnpm stores")) {
    throw new Error("node-modules-build.ts must tell operators to run `i` for stale state");
  }
  if (!txt.includes("preparedExactStoreEnv(relLock)")) {
    throw new Error("node-modules-build.ts must consume exact stores prewarmed by `i`");
  }
});

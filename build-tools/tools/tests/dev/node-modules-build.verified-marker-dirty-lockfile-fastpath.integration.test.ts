#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("node-modules-build reuses verified markers even when temp lockfiles are git-dirty", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/node-modules-build.ts"),
    "utf8",
  );
  const verifyZxNodeModules = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/verify/zx-node-modules.ts"),
    "utf8",
  );
  if (!txt.includes("await requireFreshPnpmStoreState(lockfileRel, hashKey)")) {
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
  if (!txt.includes("preparedExactStoreEnv(lockfileRel)")) {
    throw new Error("node-modules-build.ts must consume exact stores prewarmed by `i`");
  }
  if (
    !txt.includes("recoverOutPathFromLinkMarker(importer, lockfileRel)") ||
    !txt.includes("node-modules-link.${markerKey}.json") ||
    !txt.includes('fsp.access(path.join(outPath, "node_modules"))')
  ) {
    throw new Error("node-modules-build.ts must reuse the node_modules link marker before Nix");
  }
  if (
    !verifyZxNodeModules.includes("linkedNodeModulesOut(root, importer)") ||
    !verifyZxNodeModules.includes("if (linkedOut) return linkedOut") ||
    !verifyZxNodeModules.includes("node-modules-link.${markerKey}.json")
  ) {
    throw new Error("verify zx setup must reuse the node_modules link marker before Nix");
  }
  if (
    !verifyZxNodeModules.includes('path.join(root, ".viberoots", "current", "build-tools")') ||
    !verifyZxNodeModules.includes('path.join(root, "viberoots", "pnpm-lock.yaml")') ||
    !verifyZxNodeModules.includes('return "viberoots";')
  ) {
    throw new Error("verify zx setup must prefer the viberoots importer in consumer workspaces");
  }
});

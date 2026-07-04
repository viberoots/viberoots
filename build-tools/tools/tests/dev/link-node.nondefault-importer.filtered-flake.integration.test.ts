#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("link-node builds non-default importers from stable workspace flake ref", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/tools/dev/install/link-node.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("makeFilteredFlakeRef(root, importer)")) {
    throw new Error("link-node.ts must use filtered flake snapshot for non-default importers");
  }
  if (!txt.includes("withResolvedExactPrefetchedStore")) {
    throw new Error("link-node.ts must pass exact prefetched stores into node_modules builds");
  }
  if (!txt.includes('"--impure"')) {
    throw new Error("link-node.ts must use --impure for the NIX_PNPM_EXACT_STORE env handoff");
  }
  if (!txt.includes("buildFlakeRefBase")) {
    throw new Error("link-node.ts must select build flake base for non-default importer builds");
  }
  if (!txt.includes('importer === "viberoots"') || !txt.includes('path.join(root, "viberoots")')) {
    throw new Error(
      "link-node.ts must build viberoots tooling node_modules from the live viberoots flake",
    );
  }
  if (!txt.includes("await tempFlake.cleanup()")) {
    throw new Error("link-node.ts must clean up temporary filtered flake snapshot");
  }

  const compat = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/lockfile.ts"),
    "utf8",
  );
  if (
    !/export\s+async\s+function\s+makeFilteredFlakeRef\s*\([^)]*importer\?:\s*string/s.test(compat)
  ) {
    throw new Error(
      "lockfile.ts must keep the compatibility filtered-flake export for install callers",
    );
  }
  if (!compat.includes("importer,")) {
    throw new Error("lockfile.ts must pass importer scope through to filtered-flake snapshots");
  }

  const filtered = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/filtered-flake.ts"),
    "utf8",
  );
  if (!filtered.includes("dirty-tree entries=") || !filtered.includes("snapshot ready in")) {
    throw new Error("filtered-flake.ts must expose dirty-tree and snapshot-size diagnostics");
  }

  const filteredCompat = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts"),
    "utf8",
  );
  const buildFlake = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/build-flake.ts"),
    "utf8",
  );
  if (
    !filteredCompat.includes("dirty-tree entries=") ||
    !filteredCompat.includes("snapshot ready in")
  ) {
    throw new Error(
      "update-pnpm-hash filtered flake must expose dirty-tree and snapshot-size diagnostics",
    );
  }
  if (
    !filteredCompat.includes("fsp.realpath(workDirRaw)") ||
    !filteredCompat.includes("snapDirReal")
  ) {
    throw new Error(
      "update-pnpm-hash filtered flake snapshots must canonicalize temp paths before passing them to Nix",
    );
  }
  if (
    !filteredCompat.includes("findWorkspacePackageRepoDirs") ||
    !filteredCompat.includes("selectedNodeSnapshotRelPaths(opts.importer, workspacePackageDirs)") ||
    !filteredCompat.includes("selectedNodeSnapshotRsyncSources")
  ) {
    throw new Error(
      "update-pnpm-hash filtered flakes must include selected node importer and workspace package paths",
    );
  }
  if (!buildFlake.includes("importer: opts.importer")) {
    throw new Error(
      "update-pnpm-hash build flake selection must pass the importer into filtered snapshots",
    );
  }
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("link-node builds non-default importers from stable workspace flake ref", async () => {
  const file = "build-tools/tools/dev/install/link-node.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("makeFilteredFlakeRef(root)")) {
    throw new Error("link-node.ts must use filtered flake snapshot for non-default importers");
  }
  if (!txt.includes("buildFlakeRefBase")) {
    throw new Error("link-node.ts must select build flake base for non-default importer builds");
  }
  if (!txt.includes("await tempFlake.cleanup()")) {
    throw new Error("link-node.ts must clean up temporary filtered flake snapshot");
  }

  const compat = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/lockfile.ts", "utf8");
  if (!compat.includes("export async function makeFilteredFlakeRef(repoRoot: string)")) {
    throw new Error(
      "lockfile.ts must keep the compatibility filtered-flake export for install callers",
    );
  }

  const filtered = await fsp.readFile("build-tools/tools/dev/filtered-flake.ts", "utf8");
  if (!filtered.includes("dirty-tree entries=") || !filtered.includes("snapshot ready in")) {
    throw new Error("filtered-flake.ts must expose dirty-tree and snapshot-size diagnostics");
  }

  const filteredCompat = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
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
});

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
});

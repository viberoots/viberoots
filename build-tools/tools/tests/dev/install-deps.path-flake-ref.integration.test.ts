#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(path: string): Promise<string> {
  return await fsp.readFile(path, "utf8");
}

test("install path selects flake refs by importer scope", async () => {
  const common = await read("build-tools/tools/dev/install/common.ts");
  if (!common.includes("export function flakeRefForImporter(")) {
    throw new Error("common.ts must expose flakeRefForImporter");
  }
  if (!common.includes('return !imp || imp === "." ? root : `path:${root}`;')) {
    throw new Error(
      "flakeRefForImporter must use bare root for dot importer and path: for non-dot",
    );
  }

  const depsMain = await read("build-tools/tools/dev/install/deps-main.ts");
  if (!depsMain.includes("importer ${imp}: realizing+linking node_modules")) {
    throw new Error("deps-main.ts must delegate node_modules realization to link-node");
  }
  if (depsMain.includes("nix build ${flakeRef}#${attr}")) {
    throw new Error("deps-main.ts must not duplicate node-modules nix build before link-node");
  }

  const linkNode = await read("build-tools/tools/dev/install/link-node.ts");
  if (!linkNode.includes("const flakeRef = flakeRefForImporter(flakeRoot, importer);")) {
    throw new Error(
      "link-node.ts must derive flakeRef via flakeRefForImporter(flakeRoot, importer)",
    );
  }
  if (!linkNode.includes("buildFlakeRefBase")) {
    throw new Error("link-node.ts must choose importer-scoped build flake base");
  }
  if (!linkNode.includes("#node-modules.${attr}")) {
    throw new Error("link-node.ts must build node-modules attrs through computed flake ref base");
  }

  const update = await read("build-tools/tools/dev/update-pnpm-hash.ts");
  if (!update.includes("const flakeRef = flakeRefForImporter(repoRoot, importer);")) {
    throw new Error(
      "update-pnpm-hash.ts must derive flakeRef via flakeRefForImporter(repoRoot, importer)",
    );
  }

  const hashNix = await read("build-tools/tools/dev/update-pnpm-hash/nix.ts");
  if (!hashNix.includes("export async function buildStore(")) {
    throw new Error("update-pnpm-hash/nix.ts must export buildStore helper");
  }
  if (!hashNix.includes("flakeRef: string")) {
    throw new Error("update-pnpm-hash/nix.ts helpers must accept flakeRef parameter");
  }
});

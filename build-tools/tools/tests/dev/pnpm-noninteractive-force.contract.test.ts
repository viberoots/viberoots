#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

const EXPECTATIONS = [
  {
    path: "build-tools/tools/dev/update-pnpm-hash/lockfile.ts",
    fragments: [
      "withHiddenNodeModules(importerAbs",
      '"install",\n      "--force",',
      '"fetch",\n      "--force",',
    ],
  },
  {
    path: "build-tools/tools/lib/pnpm-importer-lockfile.ts",
    fragments: [
      "withHiddenNodeModules(importerAbs",
      "install --force --filter",
      "fetch --force --filter",
    ],
  },
  {
    path: "build-tools/tools/nix/node-modules/modules.nix",
    fragments: [
      "pnpm install --offline --force --no-frozen-lockfile",
      "pnpm install --offline --force --frozen-lockfile",
    ],
  },
  {
    path: "build-tools/tools/nix/node-modules/store.nix",
    fragments: [
      "pnpm install --force --frozen-lockfile --ignore-scripts --prod=false",
      "mkPnpmStoreUnfixed: pnpm install --force --frozen-lockfile",
    ],
  },
];

test("non-interactive pnpm install paths force through modules-dir purges", async () => {
  for (const expectation of EXPECTATIONS) {
    const source = await fsp.readFile(expectation.path, "utf8");
    for (const fragment of expectation.fragments) {
      if (!source.includes(fragment)) {
        throw new Error(
          `${expectation.path} is missing required non-interactive pnpm fragment: ${fragment}`,
        );
      }
    }
  }
});

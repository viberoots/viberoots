#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

const EXPECTATIONS: Array<{
  path: string;
  fragments: string[];
  checks?: Array<(source: string, file: string) => void>;
}> = [
  {
    path: "build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
    fragments: [
      "withHiddenNodeModules(importerAbs",
      '"install",\n      "--force",',
      '"fetch",\n      "--force",',
    ],
  },
  {
    path: "build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    fragments: ["withHiddenNodeModules(importerAbs", "NIX_PNPM_INSTALL_TIMEOUT: fetchTimeout"],
    checks: [
      (source, file) => {
        assert.match(
          source,
          /["']fetch["'],\s*["']--force["'],\s*["']--frozen-lockfile["']/,
          `${file} must keep exact-store fetch non-interactive and forceful`,
        );
      },
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
    for (const check of expectation.checks || []) check(source, expectation.path);
  }
});

#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const EXPECTATIONS: Array<{
  path: string;
  fragments: string[];
  checks?: Array<(source: string, file: string) => void>;
}> = [
  {
    path: "viberoots/build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
    fragments: ["withHiddenNodeModules(importerAbs"],
    checks: [
      (source, file) => {
        assert.match(
          source,
          /["']install["'],\s*["']--force["'],\s*["']--lockfile-only["']/,
          `${file} must keep importer lockfile install non-interactive and forceful`,
        );
        assert.match(
          source,
          /["']--reporter["'],\s*["']silent["']/,
          `${file} must disable pnpm progress output during lockfile provisioning`,
        );
        assert.match(
          source,
          /["']--network-concurrency["'],\s*["']1["']/,
          `${file} must keep lockfile provisioning network concurrency bounded`,
        );
        assert.match(
          source,
          /["']fetch["'],\s*["']--force["'],\s*["']--prefer-offline["']/,
          `${file} must keep importer lockfile fetch non-interactive and forceful`,
        );
      },
    ],
  },
  {
    path: "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    fragments: ["fetchExactPnpmStore({", "fetchTimeout"],
  },
  {
    path: "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts",
    fragments: [
      "withHiddenNodeModules(opts.importerAbs",
      "NIX_PNPM_INSTALL_TIMEOUT: opts.fetchTimeout",
    ],
    checks: [
      (source, file) => {
        assert.match(
          source,
          /["']install["'],\s*["']--force["'],\s*["']--frozen-lockfile["']/,
          `${file} must keep exact-store population non-interactive and forceful`,
        );
        assert.match(
          source,
          /["']--reporter["'],\s*["']silent["']/,
          `${file} must disable pnpm progress output during exact-store provisioning`,
        );
        assert.match(
          source,
          /["']--network-concurrency["'],\s*["']1["']/,
          `${file} must keep exact-store provisioning network concurrency bounded`,
        );
      },
    ],
  },
  {
    path: "viberoots/build-tools/tools/lib/pnpm-importer-lockfile.ts",
    fragments: [
      "withHiddenNodeModules(importerAbs",
      "install --force --filter",
      "fetch --force --filter",
    ],
  },
  {
    path: "viberoots/build-tools/tools/nix/node-modules/modules.nix",
    fragments: [
      '"$PNPM_BIN" install --offline --force --no-frozen-lockfile --ignore-scripts --ignore-pnpmfile --prod=false --reporter=append-only',
      '"$PNPM_BIN" install --offline --force --frozen-lockfile --ignore-scripts --ignore-pnpmfile --prod=false --reporter=append-only',
      'cat "$pnpm_log" >&2 || true',
    ],
    checks: [
      (source, file) => {
        assert.doesNotMatch(
          source,
          /PNPM_BIN=.*pnpm10/,
          `${file} mkNodeModules must not downgrade installer selection from pnpm based on pnpm-store directory version`,
        );
      },
    ],
  },
  {
    path: "viberoots/build-tools/tools/nix/node-modules/store.nix",
    fragments: [
      "validate_exact_store_shape",
      "mkPnpmStore: validating exact prefetched store shape after prior pnpm install (offline exact-store)",
      "mkPnpmStoreUnfixed: validating exact prefetched store shape after prior pnpm install (offline exact-store)",
      "Run 'i' to refresh pnpm hashes and prewarm exact pnpm stores.",
    ],
    checks: [
      (source, file) => {
        assert.doesNotMatch(
          source,
          /pnpm install --force --frozen-lockfile/,
          `${file} locked pnpm install paths must be offline-only`,
        );
      },
    ],
  },
];

test("non-interactive pnpm install paths force through modules-dir purges", async () => {
  for (const expectation of EXPECTATIONS) {
    const file = path.join(process.cwd(), expectation.path);
    const source = await fsp.readFile(file, "utf8");
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

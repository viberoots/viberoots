#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node nix runner: minimal importer with no tests passes", async () => {
  await runInTemp("node-nix-runner-smoke", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    const app = path.join(tmp, "apps", "mini");
    await fsp.mkdir(app, { recursive: true });
    // Minimal package.json (no tests, no lockfile)
    await fsp.writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ name: "mini", version: "0.0.1", type: "module" }, null, 2),
      "utf8",
    );
    // Seed a minimal lockfile so mkPnpmStore can proceed deterministically
    const lock = [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .:",
      "    devDependencies: {}",
      "",
      "packages:",
      "",
      "snapshots:",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(app, "pnpm-lock.yaml"), lock, "utf8");
    // TARGETS wiring using nix_node_test external runner; allow lockfile generation in FOD
    const targets = [
      'load("//node:defs.bzl", "nix_node_test")',
      "",
      "nix_node_test(",
      '    name = "node_tests",',
      '    lockfile_label = "lockfile:apps/mini/pnpm-lock.yaml#apps/mini",',
      '    env = {"NIX_PNPM_ALLOW_GENERATE": "1"},',
      ")",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(app, "TARGETS"), targets, "utf8");
    // Update pnpm-store FOD hash mapping for this importer lockfile
    await $`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile apps/mini/pnpm-lock.yaml`;
    // Execute the test target; with no test files present, the derivation should succeed
    await $`buck2 test //apps/mini:node_tests`;
  });
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("node nix runner: minimal importer with no tests passes", async () => {
  await runInTemp("node-nix-runner-smoke", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    const app = path.join(tmp, "projects", "apps", "mini");
    await fsp.mkdir(app, { recursive: true });
    // Minimal package.json (no tests, no lockfile)
    await fsp.writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ name: "mini", version: "0.0.1", type: "module" }, null, 2),
      "utf8",
    );
    await fsp.writeFile(path.join(app, ".pnpmfile.mjs"), "export default {};\n", "utf8");
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
      'load("@viberoots//build-tools/node:defs.bzl", "nix_node_test")',
      "",
      "nix_node_test(",
      '    name = "node_tests",',
      '    lockfile_label = "lockfile:projects/apps/mini/pnpm-lock.yaml#projects/apps/mini",',
      '    env = {"NIX_PNPM_ALLOW_GENERATE": "1"},',
      ")",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(app, "TARGETS"), targets, "utf8");
    await reconcileTempDependencyInputs(tmp, $);
    await $`buck2 cquery --target-platforms prelude//platforms:default "kind(nix_node_test, //projects/apps/mini:node_tests)"`;
    await $`buck2 test --target-platforms prelude//platforms:default //projects/apps/mini:node_tests`;
    // Supplemental no-link policy coverage for the Nix runner attr invoked by nix_node_test.
    await $`nix build --no-link --print-out-paths --impure --accept-flake-config ${`path:${await workspaceFlakeRef(tmp)}#node-test.projects-apps-mini`} -L`;
  });
});

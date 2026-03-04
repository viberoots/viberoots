#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  deriveAppIdFromTargetLabel,
  deriveAppTargetLabelFromCwd,
  resolveModuleContractsPaths,
} from "../../dev/module-contract-paths.ts";

test("PR-2 resolver derives deterministic app-id and canonical output paths", () => {
  const appTarget = "//projects/apps/demo-web:app";
  const appId = deriveAppIdFromTargetLabel(appTarget);
  assert.equal(appId, "projects-apps-demo-web-app");

  const resolved = resolveModuleContractsPaths({
    appCwd: path.join("/repo", "projects", "apps", "demo-web"),
    appTargetLabel: appTarget,
    root: "/repo",
  });
  assert.equal(
    resolved.contractsDir,
    path.join("/repo", "buck-out", "tmp", "module-contracts", "projects-apps-demo-web-app"),
  );
  assert.equal(
    resolved.wasmManifestPath,
    path.join(resolved.contractsDir, "wasm-modules.manifest.json"),
  );
  assert.equal(
    resolved.tsManifestPath,
    path.join(resolved.contractsDir, "ts-modules.manifest.json"),
  );
});

test("PR-2 resolver infers app target from app cwd", () => {
  const appTarget = deriveAppTargetLabelFromCwd(
    path.join("/repo", "projects", "apps", "my-app"),
    "/repo",
  );
  assert.equal(appTarget, "//projects/apps/my-app:app");
});

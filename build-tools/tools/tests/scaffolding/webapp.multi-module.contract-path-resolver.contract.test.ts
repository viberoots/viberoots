#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  deriveAppIdFromTargetLabel,
  deriveAppTargetLabelFromCwd,
  resolveModuleContractsPaths,
} from "../../dev/module-contract-paths";

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

test("PR-2 resolver accepts symlink-equivalent temp roots", async (t) => {
  if (process.platform !== "darwin") t.skip("macOS /tmp canonicalizes through /private/tmp");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "module-contract-paths-"));
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });
  const app = path.join(root, "projects", "apps", "my-app");
  await fsp.mkdir(app, { recursive: true });
  assert.equal(
    deriveAppTargetLabelFromCwd(app.replace(/^\/private\/tmp\//, "/tmp/"), root),
    "//projects/apps/my-app:app",
  );
});

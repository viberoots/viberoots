#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");

async function source(relative: string): Promise<string> {
  return await fs.readFile(path.join(root, relative), "utf8");
}

test("Rust and C++ extensions share language-neutral staging and evidence contracts", async () => {
  const [python, node, service, macros, action, rust, rustEvidence, nodeApi, pythonDeps] =
    await Promise.all([
      source("build-tools/tools/nix/planner/python-pyext.nix"),
      source("build-tools/tools/nix/planner/node-native-addons.nix"),
      source("build-tools/tools/nix/planner/node-service.nix"),
      source("build-tools/rust/private/macro_contract.bzl"),
      source("build-tools/rust/private/nix_build.bzl"),
      source("build-tools/tools/nix/templates/rust.nix"),
      source("build-tools/tools/nix/templates/rust-evidence-install.nix"),
      source("build-tools/tools/nix/templates/rust-node-api.nix"),
      source("build-tools/tools/nix/planner/rust-python-deps.nix"),
    ]);
  assert.match(python, /map ctx\.dependencyArtifactOf/);
  assert.doesNotMatch(python, /lang:rust/);
  assert.match(node, /builtins\.elem "lang:rust"/);
  assert.match(node, /builtins\.elem "lang:cpp"/);
  assert.match(node, /artifact = dependencyArtifactOf name/);
  assert.match(node, /requires unique stable addon names/);
  assert.match(node, /\[A-Za-z_\]\[A-Za-z0-9_-\]\*/);
  assert.doesNotMatch(node, /mkAddon|mkRust|mkCpp/);
  assert.ok(
    service.indexOf('nativeAddons.stage addons "$PWD/dist/native"') <
      service.indexOf("service-artifact.ts"),
    "service identity must be computed after native addons enter the deployable tree",
  );
  for (const field of [
    "artifact_contract",
    "materialization_manifest",
    "source_snapshot_bundle",
    "tool_closure",
  ]) {
    assert.ok(macros.includes(`"${field}"`), `missing public evidence field ${field}`);
    assert.ok(action.includes(`ctx.attrs.${field}`), `missing action evidence field ${field}`);
  }
  assert.match(rust, /import \.\/rust-node-api\.nix/);
  assert.match(nodeApi, /process\.versions\.napi/);
  assert.match(nodeApi, /node_api_module_get_api_version_v1/);
  assert.match(rust, /import \.\/rust-evidence-install\.nix/);
  assert.match(rustEvidence, /materialization-manifest\.json/);
  assert.match(rust, /pythonWheelhouse/);
  assert.doesNotMatch(rust, /pkgs\.python3\.pkgs/);
  assert.match(pythonDeps, /pythonTemplate\.pyWheelhouse/);
  assert.match(pythonDeps, /parseImporterScopedLockfileLabel/);
});

import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { inheritedBuckIsolation } from "../lib/test-helpers";

export const expectedPlan = (planTarget: string) => ({
  target: planTarget,
  nixpkgs_profile: "default",
  nixpkg_pins: { "pkgs.zlib": { nixpkgs_profile: "default" } },
});

export function rustIdentity(node: Record<string, unknown>) {
  return {
    cargo_manifest: node.cargo_manifest,
    cargo_lock: node.cargo_lock,
    cargo_root: node.cargo_root,
    cargo_package: node.cargo_package,
    cargo_lock_identity: node.cargo_lock_identity,
    cargo_output_hashes: node.cargo_output_hashes,
    cargo_fixed_sources: node.cargo_fixed_sources,
    crate: node.crate,
    public_crate: node.public_crate,
    crate_type: node.crate_type,
    host_role: node.host_role,
    generated_outputs: node.generated_outputs,
    features: node.features,
    default_features: node.default_features,
    profile: node.profile,
    target: node.target,
    labels: node.labels,
    nixpkgs_profile: node.nixpkgs_profile,
    nixpkg_pins: node.nixpkg_pins,
  };
}

export async function assertRustSourceBytesAgree(roots: string[]): Promise<void> {
  for (const relative of ["Cargo.toml", "Cargo.lock", "build.rs", path.join("src", "main.rs")]) {
    const files = await Promise.all(roots.map((root) => fsp.readFile(path.join(root, relative))));
    for (const candidate of files.slice(1)) assert.deepEqual(candidate, files[0], relative);
  }
}

export async function assertActualRustBuckSnapshotExecution(
  workspace: string,
  hostileWorkerEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const actualBuckBuild = await $({
    cwd: workspace,
    env: hostileWorkerEnv,
    stdio: "pipe",
  })`buck2 --isolation-dir ${inheritedBuckIsolation("rust_remote_actual_build")} build //projects/apps/rust-parity:app --show-full-output`;
  const buckArtifact = String(actualBuckBuild.stdout || "")
    .trim()
    .split(/\s+/)
    .at(-1);
  assert.ok(buckArtifact, "actual Rust Buck build did not report its output");
  const actualBuildExecution = await $({
    env: hostileWorkerEnv,
    stdio: "pipe",
  })`${path.isAbsolute(buckArtifact) ? buckArtifact : path.join(workspace, buckArtifact)}`;
  assert.equal(String(actualBuildExecution.stdout || "").trim(), "rust-source-selection-ok");

  const reviewedNixConfig = String(hostileWorkerEnv.NIX_CONFIG || "");
  assert.equal(hostileWorkerEnv.VBR_NIX_CACHE_HEALTH_APPLIED, "1");
  assert.equal(hostileWorkerEnv.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, reviewedNixConfig);
  assert.doesNotMatch(
    reviewedNixConfig,
    /https?:\/\/(?:[^/\s]*@|[^\s]*[?&#](?:access[_-]?token|api[_-]?key|apikey|auth|authorization|credential|credentials|password|passwd|secret|sig|signature|token)=)/iu,
    "reviewed nested Nix authority must not embed URL credentials",
  );
  const reviewedCacheEnv = ["--env", `NIX_CONFIG=${reviewedNixConfig}`];
  const actualBuckTest = await $({
    cwd: workspace,
    env: hostileWorkerEnv,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 --isolation-dir ${inheritedBuckIsolation("rust_remote_actual_test")} test --local-only --no-remote-cache --target-platforms prelude//platforms:default //projects/apps/rust-parity:app-test -- ${reviewedCacheEnv}`;
  assert.equal(actualBuckTest.exitCode, 0, String(actualBuckTest.stderr || ""));
}

import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runArtifactNix } from "../../ci/artifact-command";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import {
  findViberootsRoot,
  immutableViberootsInput,
  seedWorkspaceLockFromCommittedAuthority,
  writeFixtureFile,
} from "../viberoots/registry-extension-fixture";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";
import { ensureToolchainPathsForTempRepo } from "../lib/test-helpers/toolchain-paths";

const execFileAsync = promisify(execFile);
export const target = "//projects/apps/rust-parity:app";
export const testTarget = "//projects/apps/rust-parity:app-test";
export { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

const nixFlakeFeatures = ["--extra-experimental-features", "nix-command flakes"];

export async function prepareRustConsumer(workspace: string, $: any): Promise<string> {
  const viberootsRoot = await findViberootsRoot();
  const flakeInput = await immutableViberootsInput(viberootsRoot);
  await execFileAsync(
    path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
    [
      "init-consumer",
      "--workspace-root",
      workspace,
      "--workspace-name",
      "rust-identity-parity",
      "--viberoots-url",
      `path:${flakeInput}`,
      "--source",
      viberootsRoot,
      "--no-lock",
      "--no-direnv",
    ],
    { cwd: workspace, env: { ...process.env, NO_DEV_SHELL: "1" } },
  );
  await seedWorkspaceLockFromCommittedAuthority(workspace);
  const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
  await runArtifactNix({
    workspaceRoot: workspace,
    artifactToolsRoot,
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    args: [
      ...nixFlakeFeatures,
      "flake",
      "lock",
      "--offline",
      "--accept-flake-config",
      "--override-input",
      "viberoots",
      `path:${flakeInput}`,
      "path:.viberoots/workspace",
    ],
  });
  const hiddenLock = path.join(workspace, ".viberoots", "workspace", "flake.lock");
  const rootLock = path.join(workspace, "flake.lock");
  await fsp.copyFile(hiddenLock, rootLock);
  if (!(await fsp.readFile(rootLock)).equals(await fsp.readFile(hiddenLock))) {
    throw new Error("Rust identity fixture root and hidden locks diverged");
  }
  await ensureBuckConfigForTempRepo(workspace, $, {
    viberootsInputRoot: flakeInput,
    viberootsSourceRoot: viberootsRoot,
  });
  await ensureToolchainPathsForTempRepo(workspace, $);

  const packageRoot = path.join(workspace, "projects", "apps", "rust-parity");
  await writeFixtureFile(
    path.join(packageRoot, "TARGETS"),
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_binary")',
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_test")',
      'load("@viberoots//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
      "",
      "rust_binary(",
      '    name = "app",',
      '    artifact_contract = "remote-evidence/artifact-contract.json",',
      '    crate = "rust-parity",',
      '    labels = ["remote:ready"],',
      '    materialization_manifest = "remote-evidence/materialization-manifest.json",',
      '    nixpkg_deps = ["pkgs.xz", "pkgs.zlib"],',
      "    nixpkg_pins = {",
      '        "pkgs.zlib": {',
      '            "nixpkgs_profile": "default",',
      '            "rationale": "Rust identity parity fixture pin.",',
      "        },",
      "    },",
      '    srcs = ["src/main.rs"],',
      '    remote_builder_smoke = "remote-evidence/remote-builder-smoke.json",',
      '    source_snapshot_bundle = ":remote-snapshot",',
      '    tool_closure = "remote-evidence/tool-closure.json",',
      ")",
      "",
      "rust_test(",
      '    name = "app-test",',
      '    artifact_contract = "remote-evidence/artifact-contract.json",',
      '    crate = "rust-parity",',
      '    labels = ["remote:ready"],',
      '    materialization_manifest = "remote-evidence/materialization-manifest.json",',
      '    nixpkg_deps = ["pkgs.xz", "pkgs.zlib"],',
      "    nixpkg_pins = {",
      '        "pkgs.zlib": {',
      '            "nixpkgs_profile": "default",',
      '            "rationale": "Rust identity parity fixture pin.",',
      "        },",
      "    },",
      '    srcs = ["src/main.rs"],',
      '    remote_builder_smoke = "remote-evidence/remote-builder-smoke.json",',
      '    source_snapshot_bundle = ":remote-snapshot",',
      '    tool_closure = "remote-evidence/tool-closure.json",',
      ")",
      "",
      "source_snapshot(",
      '    name = "remote-snapshot",',
      '    destination_prefix = "projects/apps/rust-parity",',
      '    graph = "graph.json",',
      '    srcs = glob(["remote-src/**"]),',
      '    strip_prefix = "remote-src",',
      ")",
      "",
    ].join("\n"),
  );
  await writeFixtureFile(
    path.join(packageRoot, "Cargo.toml"),
    [
      "[package]",
      'name = "rust-parity"',
      'version = "0.1.0"',
      'edition = "2021"',
      'build = "build.rs"',
      "",
      "[[bin]]",
      'name = "app"',
      'path = "src/main.rs"',
      "",
    ].join("\n"),
  );
  await writeFixtureFile(
    path.join(packageRoot, "Cargo.lock"),
    'version = 3\n\n[[package]]\nname = "rust-parity"\nversion = "0.1.0"\n',
  );
  await writeFixtureFile(
    path.join(packageRoot, "src", "main.rs"),
    [
      'fn main() { println!("rust-source-selection-ok"); }',
      "#[cfg(test)]",
      "mod tests {",
      "  #[test]",
      '  fn prepared_worker_runs_tests() { assert_eq!(2 + 2, 4, "prepared Rust test failed"); }',
      "}",
      "",
    ].join("\n"),
  );
  await writeFixtureFile(
    path.join(packageRoot, "build.rs"),
    [
      "use std::process::Command;",
      "fn main() {",
      '  for package in ["zlib", "liblzma"] {',
      '    let ok = Command::new("pkg-config").args(["--exists", package]).status().unwrap();',
      '    assert!(ok.success(), "missing declared native package: {}", package);',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  for (const relative of ["Cargo.lock", "Cargo.toml", "build.rs", path.join("src", "main.rs")]) {
    const source = path.join(packageRoot, relative);
    const destination = path.join(packageRoot, "remote-src", relative);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
  for (const relative of [
    "artifact-contract.json",
    "materialization-manifest.json",
    "remote-builder-smoke.json",
    "tool-closure.json",
  ]) {
    const source = path.join(
      viberootsRoot,
      "build-tools",
      "tools",
      "tests",
      "remote-exec",
      "wrapper-fixtures",
      relative,
    );
    const destination = path.join(packageRoot, "remote-evidence", relative);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
  const graphNode = (name: string, kind: "bin" | "test") => ({
    name,
    rule_type: "rust_binary",
    labels: ["lang:rust", `kind:${kind}`, "nixpkg:pkgs.xz", "nixpkg:pkgs.zlib", "remote:ready"],
    deps: [],
    srcs: ["src/main.rs", "build.rs"],
    cargo_manifest: "Cargo.toml",
    cargo_lock: "Cargo.lock",
    crate: "rust-parity",
    features: [],
    default_features: true,
    profile: "release",
    target: "",
    local_patch_dirs: [],
    nixpkgs_profile: "default",
    nixpkg_pins: {
      "pkgs.zlib": {
        nixpkgs_profile: "default",
        rationale: "Rust identity parity fixture pin.",
      },
    },
  });
  const graph =
    JSON.stringify(
      [graphNode(target, "bin"), { ...graphNode(testTarget, "test"), rule_type: "rust_test" }],
      null,
      2,
    ) + "\n";
  await writeFixtureFile(
    path.join(workspace, ".viberoots", "workspace", "buck", "graph.json"),
    graph,
  );
  await writeFixtureFile(path.join(packageRoot, "graph.json"), graph);
  return flakeInput;
}

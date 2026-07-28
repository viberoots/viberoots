import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runArtifactNix } from "../../ci/artifact-command";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";
import { installCanonicalArtifactToolsAuthority } from "../../lib/artifact-tool-authority";
import {
  findViberootsRoot,
  immutableViberootsInput,
  seedWorkspaceLockFromCommittedAuthority,
  writeFixtureFile,
} from "../viberoots/registry-extension-fixture";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";
import { ensureToolchainPathsForTempRepo } from "../lib/test-helpers/toolchain-paths";
import { buildCurrentArtifactTools } from "./rust.source-selection.identity-bundle";
import { rustIdentityUpdateEnvironment } from "./rust.source-selection.identity-update-environment";

const execFileAsync = promisify(execFile);
export const target = "//projects/apps/rust-parity:app";
export const testTarget = "//projects/apps/rust-parity:app-test";
export { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

const nixFlakeFeatures = artifactNixExperimentalFeatureArgs();

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
      flakeInput,
      "--no-lock",
      "--no-direnv",
    ],
    { cwd: workspace, env: { ...process.env, NO_DEV_SHELL: "1" } },
  );
  await seedWorkspaceLockFromCommittedAuthority(workspace);
  const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const currentToolsRoot = await buildCurrentArtifactTools(workspace, flakeInput);
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
    viberootsSourceRoot: flakeInput,
  });
  await ensureToolchainPathsForTempRepo(workspace, $);
  await installCanonicalArtifactToolsAuthority(workspace, currentToolsRoot);

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
      '    cargo_package = "rust-parity",',
      '    crate = "rust-parity",',
      '    labels = ["remote:ready"],',
      '    materialization_manifest = "remote-evidence/materialization-manifest.json",',
      '    nixpkg_deps = ["pkgs.zlib"],',
      '    public_crate = "rust_parity",',
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
      '    cargo_package = "rust-parity",',
      '    crate = "rust-parity",',
      '    labels = ["remote:ready"],',
      '    materialization_manifest = "remote-evidence/materialization-manifest.json",',
      '    nixpkg_deps = ["pkgs.zlib"],',
      '    public_crate = "rust_parity",',
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
    'fn main() {\n    println!("rust-source-selection-ok");\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn prepared_worker_runs_tests() {\n        assert_eq!(2 + 2, 4, "prepared Rust test failed");\n    }\n}\n',
  );
  await writeFixtureFile(
    path.join(packageRoot, "build.rs"),
    'use std::process::Command;\n\nfn main() {\n    for package in ["zlib"] {\n        let ok = Command::new("pkg-config")\n            .args(["--exists", package])\n            .status()\n            .unwrap();\n        assert!(ok.success(), "missing declared native package: {}", package);\n    }\n}\n',
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
      flakeInput,
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
  await writeFixtureFile(path.join(packageRoot, "graph.json"), "[]\n");
  await ensureToolchainPathsForTempRepo(workspace, $);
  await installCanonicalArtifactToolsAuthority(workspace, currentToolsRoot);
  const pinnedGit = path.join(currentToolsRoot, "bin", "git");
  await execFileAsync(pinnedGit, ["init", "--quiet"], { cwd: workspace });
  await execFileAsync(pinnedGit, ["add", "-f", "projects"], { cwd: workspace });
  const updateEnv = await rustIdentityUpdateEnvironment(workspace, currentToolsRoot);
  await execFileAsync(
    path.join(currentToolsRoot, "bin", "bash"),
    [path.join(flakeInput, "build-tools", "tools", "bin", "u")],
    {
      cwd: workspace,
      env: {
        ...updateEnv,
        NO_DEV_SHELL: "1",
        WORKSPACE_ROOT: workspace,
        VIBEROOTS_FLAKE_INPUT_ROOT: flakeInput,
        VIBEROOTS_SOURCE_ROOT: flakeInput,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const graphPath = path.join(workspace, ".viberoots", "workspace", "buck", "graph.json");
  const graph = await fsp.readFile(graphPath, "utf8");
  const appNode = (JSON.parse(graph) as Array<Record<string, unknown>>).find(
    (node) => node.name === target,
  );
  if (
    appNode?.cargo_package !== "rust-parity" ||
    appNode.public_crate !== "rust_parity" ||
    appNode.crate_type !== "bin" ||
    appNode.host_role !== "target"
  ) {
    throw new Error("canonical update exported stale Rust composition attributes");
  }
  for (const relative of ["Cargo.lock", "Cargo.toml", "build.rs", path.join("src", "main.rs")]) {
    await fsp.copyFile(
      path.join(packageRoot, relative),
      path.join(packageRoot, "remote-src", relative),
    );
  }
  await writeFixtureFile(path.join(packageRoot, "graph.json"), graph);
  return flakeInput;
}

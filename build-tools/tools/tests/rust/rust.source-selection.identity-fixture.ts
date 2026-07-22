import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
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
  await execFileAsync(
    path.join(canonicalArtifactToolsRoot(process.cwd()), "bin", "nix"),
    [
      "flake",
      "lock",
      "--offline",
      "--accept-flake-config",
      "--override-input",
      "viberoots",
      `path:${flakeInput}`,
      "path:.viberoots/workspace",
    ],
    { cwd: workspace, maxBuffer: 16 * 1024 * 1024 },
  );
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
      'load("@viberoots//build-tools/lang:source_snapshot.bzl", "source_snapshot")',
      "",
      "rust_binary(",
      '    name = "app",',
      '    crate = "rust-parity",',
      '    nixpkg_deps = ["pkgs.xz", "pkgs.zlib"],',
      "    nixpkg_pins = {",
      '        "pkgs.zlib": {',
      '            "nixpkgs_profile": "default",',
      '            "rationale": "Rust identity parity fixture pin.",',
      "        },",
      "    },",
      '    srcs = ["src/main.rs"],',
      ")",
      "",
      "source_snapshot(",
      '    name = "remote-snapshot",',
      '    graph = "graph.json",',
      "    srcs = [",
      '        "Cargo.lock",',
      '        "Cargo.toml",',
      '        "TARGETS",',
      '        "build.rs",',
      '        "src/main.rs",',
      "    ],",
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
    'fn main() { println!("rust-source-selection-ok"); }\n',
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
  const graph =
    JSON.stringify(
      [
        {
          name: target,
          rule_type: "rust_binary",
          labels: ["lang:rust", "kind:bin", "nixpkg:pkgs.xz", "nixpkg:pkgs.zlib"],
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
        },
      ],
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

export async function buildCanonicalBundle(
  workspace: string,
  attr: "graph-generator-selected" | "graph-generator",
  immutableViberootsInputRoot: string,
): Promise<{ outPath: string; bundleSource: string }> {
  const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const graphPath = path.join(workspace, ".viberoots", "workspace", "buck", "graph.json");
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot: workspace,
    attr,
    target: attr === "graph-generator-selected" ? target : undefined,
    graphPath,
    logPrefix: "[rust-identity-parity]",
    classification: "local-development",
    env: buildCanonicalArtifactEnvironment(workspace, { artifactToolsRoot }),
    selectorEnv: {},
    immutableViberootsInputRoot,
  });
  try {
    const { stdout } = await execFileAsync(
      path.join(artifactToolsRoot, "bin", "nix"),
      [
        "build",
        "--accept-flake-config",
        "--no-write-lock-file",
        bundle.flakeRef,
        "--no-link",
        "--print-out-paths",
      ],
      { cwd: workspace, maxBuffer: 32 * 1024 * 1024 },
    );
    const outPath = String(stdout || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .at(-1);
    if (!outPath) throw new Error(`missing ${attr} output path`);
    return { outPath, bundleSource: bundle.workspaceRoot };
  } finally {
    await bundle.cleanup();
  }
}

import path from "node:path";
import * as fs from "node:fs/promises";
import { discoverImportersWithLock } from "../install/importers";
import { projectModuleDirs } from "./surfaces";

const filesByManifest: Record<string, string[]> = {
  "Cargo.toml": ["Cargo.lock"],
  "go.mod": ["go.mod", "go.sum", "gomod2nix.toml"],
  "pyproject.toml": ["uv.lock"],
};

export async function updateTransactionFiles(root: string): Promise<string[]> {
  const files = new Set<string>([
    path.join(root, "flake.lock"),
    path.join(root, ".buckconfig"),
    path.join(root, ".buckroot"),
    path.join(root, ".viberoots/current"),
    path.join(root, ".nix-gcroots/artifact-tools"),
    path.join(root, ".nix-gcroots/.artifact-tools.candidate"),
    path.join(root, ".viberoots/workspace/TARGETS"),
    path.join(root, ".viberoots/workspace/flake.nix"),
    path.join(root, ".viberoots/workspace/flake.lock"),
    path.join(root, ".viberoots/workspace/nixpkgs-source-registry-extension.nix"),
    path.join(root, ".viberoots/workspace/toolchain-paths.json"),
    path.join(root, ".viberoots/workspace/toolchains"),
    path.join(root, ".viberoots/workspace/providers/TARGETS"),
    path.join(root, ".viberoots/workspace/providers/auto_map.bzl"),
    path.join(root, ".viberoots/workspace/providers/provider_index.bzl"),
    path.join(root, ".viberoots/workspace/providers/provider_index.json"),
    path.join(root, ".viberoots/workspace/providers/nix_attr_map.bzl"),
    path.join(root, ".viberoots/workspace/providers/TARGETS.node.auto"),
    path.join(root, ".viberoots/workspace/providers/TARGETS.python.auto"),
    path.join(root, ".viberoots/workspace/providers/TARGETS.rust.auto"),
    path.join(root, ".viberoots/workspace/buck/graph.json"),
    path.join(root, ".viberoots/workspace/buck/node-lock-index.json"),
    path.join(root, ".viberoots/workspace/buck/invalidation-report.txt"),
    path.join(root, ".viberoots/workspace/node/workspace-map.json"),
    path.join(root, "build-tools/tools/nix/node-modules.hashes.json"),
    path.join(root, "projects/TARGETS"),
    path.join(root, "projects/node-modules.hashes.json"),
    path.join(root, "projects/config/TARGETS"),
    path.join(root, "projects/config/cargo-fixed-sources.json"),
    path.join(root, "projects/config/node-modules.hashes.json"),
    path.join(root, "toolchains/toolchain_paths.bzl"),
  ]);
  const collectExistingFiles = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collectExistingFiles(file);
      else files.add(file);
    }
  };
  for (const generatedDirectory of ["buck", "node", "providers", "resource-graph"]) {
    await collectExistingFiles(path.join(root, ".viberoots/workspace", generatedDirectory));
  }
  for (const [manifest, ownedFiles] of Object.entries(filesByManifest)) {
    for (const directory of await projectModuleDirs(root, manifest)) {
      for (const file of ownedFiles) files.add(path.join(directory, file));
    }
  }
  for (const importer of await discoverImportersWithLock(root, { cwd: root })) {
    const directory = path.join(root, importer);
    files.add(path.join(directory, "package.json"));
    files.add(path.join(directory, "pnpm-lock.yaml"));
  }
  return [...files];
}

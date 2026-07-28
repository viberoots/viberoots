import * as fs from "node:fs/promises";
import path from "node:path";
import type { MaterializedPathInput } from "../../dev/filtered-flake-viberoots-input";
import { ensureToolchainPathsFiles } from "../../dev/toolchain-paths";
import { readGlobalNixInputTargets } from "../../lib/global-nix-input-targets";

export async function pinTempViberootsInput(
  tmp: string,
  input: MaterializedPathInput,
  refreshArtifactTools = false,
): Promise<void> {
  await fs.rm(path.join(tmp, "viberoots"), { force: true, recursive: true });
  const current = path.join(tmp, ".viberoots", "current");
  await fs.rm(current, { force: true, recursive: true });
  await fs.symlink(input.storePath, current, "dir");

  const workspace = path.join(tmp, ".viberoots", "workspace");
  await fs.writeFile(
    path.join(workspace, "flake.nix"),
    `{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    buck2.url = "github:facebook/buck2/201beb86106fecdc84e30260b0f1abb5bf576988";
    gomod2nix.url = "github:nix-community/gomod2nix";
    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";
    rust-overlay.url = "github:oxalica/rust-overlay/c67ce00525464a710971351c183ce67acb6ca827";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
    viberoots.url = "path:${input.storePath}";
    viberoots.inputs.nixpkgs.follows = "nixpkgs";
    viberoots.inputs.buck2.follows = "buck2";
    viberoots.inputs.gomod2nix.follows = "gomod2nix";
    viberoots.inputs.rust-overlay.follows = "rust-overlay";
  };
  outputs = { viberoots, ... }: viberoots.lib.mkWorkspace {
    workspaceSrc = ../..;
    viberootsInput = viberoots;
    workspaceName = "acceptance";
  };
}
`,
  );
  const lock = JSON.parse(await fs.readFile(path.join(input.storePath, "flake.lock"), "utf8"));
  const inheritedInputs = { ...lock.nodes.root.inputs };
  lock.nodes.viberoots = {
    inputs: Object.fromEntries(
      Object.keys(inheritedInputs).map((name) => [name, [name.replace(/_2$/, "")]]),
    ),
    locked: { ...input.locked, path: input.storePath, type: "path" },
    original: { path: input.storePath, type: "path" },
  };
  lock.nodes.root.inputs = { ...inheritedInputs, viberoots: "viberoots" };
  await fs.writeFile(path.join(workspace, "flake.lock"), `${JSON.stringify(lock, null, 2)}\n`);
  await pinRootRustOverlay(tmp, lock, inheritedInputs);
  const targets = await readGlobalNixInputTargets(tmp);
  await fs.writeFile(path.join(workspace, "TARGETS"), targets.workspaceTargets);
  await fs.writeFile(
    path.join(tmp, "projects", "config", "TARGETS"),
    targets.projectsConfigTargets,
  );
  if (refreshArtifactTools) {
    await ensureToolchainPathsFiles(tmp, {
      refresh: true,
      artifactToolsFlakeRef: `path:${input.storePath}`,
    });
  }
}

async function pinRootRustOverlay(
  tmp: string,
  sourceLock: Record<string, any>,
  inheritedInputs: Record<string, any>,
): Promise<void> {
  const flakePath = path.join(tmp, "flake.nix");
  let flake = await fs.readFile(flakePath, "utf8");
  if (!flake.includes("rust-overlay.url")) {
    flake = flake.replace(
      '    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";',
      [
        '    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";',
        '    rust-overlay.url = "github:oxalica/rust-overlay/c67ce00525464a710971351c183ce67acb6ca827";',
        '    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";',
      ].join("\n"),
    );
  }
  if (!flake.includes("viberoots.inputs.rust-overlay.follows")) {
    flake = flake.replace(
      '    viberoots.inputs.gomod2nix.follows = "gomod2nix";',
      [
        '    viberoots.inputs.gomod2nix.follows = "gomod2nix";',
        '    viberoots.inputs.rust-overlay.follows = "rust-overlay";',
      ].join("\n"),
    );
  }
  if (
    !flake.includes("rust-overlay.url") ||
    !flake.includes("viberoots.inputs.rust-overlay.follows")
  ) {
    throw new Error("temporary root flake cannot declare the reviewed rust-overlay authority");
  }
  await fs.writeFile(flakePath, flake);

  const lockPath = path.join(tmp, "flake.lock");
  const rootLock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  const sourceOverlayId = inheritedInputs["rust-overlay"];
  const sourceOverlay = sourceLock.nodes?.[sourceOverlayId];
  const rootNode = rootLock.nodes?.root;
  const viberootsNode = rootLock.nodes?.viberoots;
  if (!sourceOverlay || !rootNode?.inputs || !viberootsNode?.inputs) {
    throw new Error("temporary root lock cannot pin the reviewed rust-overlay authority");
  }
  const overlayId = "rust-overlay-viberoots";
  rootLock.nodes[overlayId] = structuredClone(sourceOverlay);
  rootNode.inputs["rust-overlay"] = overlayId;
  viberootsNode.inputs["rust-overlay"] = ["rust-overlay"];
  await fs.writeFile(lockPath, `${JSON.stringify(rootLock, null, 2)}\n`);
}

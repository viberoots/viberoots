import * as fsp from "node:fs/promises";
import path from "node:path";

export async function readPinnedSubmoduleConsumerLock(workspaceFlake: string): Promise<string> {
  const lock = JSON.parse(await fsp.readFile(path.join(workspaceFlake, "flake.lock"), "utf8"));
  const root = lock.nodes[lock.root];
  root.inputs = {
    ...root.inputs,
    buck2: "buck2",
    gomod2nix: "gomod2nix",
    nixpkgs: "nixpkgs_2",
    nixpkgs_23_11: "nixpkgs_23_11",
  };
  lock.nodes.nixpkgs_23_11 = {
    locked: {
      lastModified: 1720535198,
      narHash: "sha256-zwVvxrdIzralnSbcpghA92tWu2DV2lwv89xZc8MTrbg=",
      owner: "NixOS",
      repo: "nixpkgs",
      rev: "205fd4226592cc83fd4c0885a3e4c9c400efabb5",
      type: "github",
    },
    original: {
      owner: "NixOS",
      ref: "nixos-23.11",
      repo: "nixpkgs",
      type: "github",
    },
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

import os from "node:os";
import path from "node:path";

export function pinnedNixpkgsOutPathExpr(lockPath: string): string {
  return String.raw`let
    lock = builtins.fromJSON (builtins.readFile ${JSON.stringify(lockPath)});
    rootNode = builtins.getAttr lock.root lock.nodes;
    rootInputs = rootNode.inputs or {};
    viberootsNode = if rootInputs ? viberoots then builtins.getAttr rootInputs.viberoots lock.nodes else {};
    viberootsInputs = viberootsNode.inputs or {};
    nixpkgsInput =
      if rootInputs ? nixpkgs then rootInputs.nixpkgs
      else if viberootsInputs ? nixpkgs then viberootsInputs.nixpkgs
      else "";
    nixpkgsNode = builtins.getAttr nixpkgsInput lock.nodes;
  in (builtins.fetchTree nixpkgsNode.locked).outPath`;
}

export function pinnedNixpkgsPackageExpr(lockPath: string, packageExpr: string): string {
  return String.raw`let
    nixpkgsPath = ${pinnedNixpkgsOutPathExpr(lockPath)};
    pkgs = import nixpkgsPath { system = builtins.currentSystem; };
  in ${packageExpr}`;
}

export function pinnedCacertBundleExpr(lockPath: string): string {
  return pinnedNixpkgsPackageExpr(lockPath, 'pkgs.cacert + "/etc/ssl/certs/ca-bundle.crt"');
}

export function nixEvalTempDirOutsideWorkspace(workspaceRoot: string): string {
  const base = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const workspaceBase = path.basename(path.resolve(workspaceRoot)) || "workspace";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  return path.join(base, `viberoots-nix-eval-${workspaceBase}${noindex}`);
}

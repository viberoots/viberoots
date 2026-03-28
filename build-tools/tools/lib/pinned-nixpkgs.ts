import os from "node:os";
import path from "node:path";

export function pinnedNixpkgsOutPathExpr(lockPath: string): string {
  return String.raw`let
    lock = builtins.fromJSON (builtins.readFile ${JSON.stringify(lockPath)});
    rootNode = builtins.getAttr lock.root lock.nodes;
    nixpkgsNode = builtins.getAttr rootNode.inputs.nixpkgs lock.nodes;
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
  return path.join(base, `bucknix-nix-eval-${workspaceBase}`);
}

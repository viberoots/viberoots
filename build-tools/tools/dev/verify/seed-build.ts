import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export type VerifySeedBuildMode = "local" | "remote-ready";

function seedFlakeRef(root: string): string {
  const hiddenWorkspaceFlake = path.join(root, ".viberoots", "workspace", "flake.nix");
  const flakeRoot = fs.existsSync(hiddenWorkspaceFlake)
    ? path.join(root, ".viberoots", "workspace")
    : root;
  return `path:${flakeRoot}#test-seed`;
}

export function verifySeedBuildArgs(opts: {
  root: string;
  mode: VerifySeedBuildMode;
  gcRootPath?: string;
}): string[] {
  const flakeRef = seedFlakeRef(opts.root);
  const base = [
    "build",
    "--option",
    "eval-cache",
    "false",
    "--impure",
    flakeRef,
    "--accept-flake-config",
  ];
  if (opts.mode === "remote-ready") return [...base, "--no-link", "--print-out-paths"];
  if (!opts.gcRootPath) throw new Error("local verify seed build requires a GC root out-link");
  return [...base, "--out-link", opts.gcRootPath, "--print-out-paths"];
}

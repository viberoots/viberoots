import fs from "node:fs";
import path from "node:path";

export function inferBootstrapConsumerModeSync(workspaceRoot: string): "flake" | "submodule" {
  try {
    const flake = fs.readFileSync(path.join(workspaceRoot, "flake.nix"), "utf8");
    if (/\bviberoots\.url\s*=\s*"path:\.\//.test(flake)) return "submodule";
    if (/\bviberoots\.url\s*=\s*"(?:git\+|github:|https?:)/.test(flake)) return "flake";
  } catch {}
  try {
    if (fs.readlinkSync(path.join(workspaceRoot, ".viberoots", "current")) === "../viberoots") {
      return "submodule";
    }
  } catch {}
  return "flake";
}

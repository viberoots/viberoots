import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../../lib/repo";

function isExplicitViberootsRepoRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "flake.nix")) &&
    fs.existsSync(path.join(candidate, "pnpm-lock.yaml")) &&
    fs.existsSync(path.join(candidate, "build-tools", "tools"))
  );
}

export async function resolveUpdatePnpmHashCommandRoot(cwd: string): Promise<string> {
  const candidate = path.resolve(cwd);
  if (isExplicitViberootsRepoRoot(candidate)) return fs.realpathSync.native(candidate);
  return await findRepoRoot(candidate);
}

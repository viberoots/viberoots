import path from "node:path";

/** Persistent Cargo state must stay outside the generated workspace flake root. */
export function workspaceCargoHome(root: string): string {
  return path.join(root, ".viberoots", "cargo-home.noindex");
}

/** Cargo's verified registry cache may be shared while workspace manifests stay private. */
export function cargoCommandHome(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const shared = String(env.VBR_SHARED_CARGO_HOME || "").trim();
  if (shared) return path.resolve(shared);
  const verifyLockDir = String(env.VBR_VERIFY_LOCK_DIR || "").trim();
  if (verifyLockDir) {
    return path.resolve(verifyLockDir, "..", "..", "cargo-home.noindex");
  }
  return workspaceCargoHome(root);
}

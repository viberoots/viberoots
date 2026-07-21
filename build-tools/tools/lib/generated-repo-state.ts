import path from "node:path";

export const GENERATED_REPO_STATE_PATHS = [
  ".DS_Store",
  ".codex-logs",
  ".direnv",
  ".full-test-output.log",
  ".nix-gcroots",
  ".nix-zsh",
  ".patch-sessions.json",
  "test-tmp-paths.log",
  "viberoots-flake-input",
  path.join(".viberoots", "buck"),
  path.join(".viberoots", "cache"),
  path.join(".viberoots", "codex-logs"),
  path.join(".viberoots", "workspace", "backups"),
  path.join(".viberoots", "workspace", "buck"),
  path.join(".viberoots", "workspace", ".viberoots"),
  path.join(".viberoots", "workspace", "cache"),
  path.join(".viberoots", "workspace", "codex-test-logs"),
  path.join(".viberoots", "workspace", "exact-env-smoke.out"),
  path.join(".viberoots", "workspace", "host-path"),
  path.join(".viberoots", "workspace", "install-cache"),
  path.join(".viberoots", "workspace", "nix-xdg-cache"),
  path.join(".viberoots", "workspace", "node"),
  path.join(".viberoots", "workspace", "pr-logs"),
  path.join(".viberoots", "workspace", "viberoots-flake-input"),
  path.join(".viberoots", "workspace", "xdg-cache"),
  "buck-out",
  path.join("build-tools", "tmp"),
  path.join("build-tools", "tools", "dev", "toolchain-paths.json"),
  path.join("toolchains", "toolchain_paths.bzl"),
  path.join("viberoots", ".cache"),
  path.join("viberoots", ".clinic"),
  path.join("viberoots", ".codex-logs"),
  path.join("viberoots", ".direnv"),
  path.join("viberoots", ".DS_Store"),
  path.join("viberoots", ".full-test-output.log"),
  path.join("viberoots", ".nix-gcroots"),
  path.join("viberoots", ".nix-zsh"),
  path.join("viberoots", ".patch-sessions.json"),
  path.join("viberoots", ".pnpm-store"),
  path.join("viberoots", ".viberoots"),
  path.join("viberoots", "backups"),
  path.join("viberoots", "buck-out"),
  path.join("viberoots", "build-tools", "tmp"),
  path.join("viberoots", "build-tools", "tools", "dev", "toolchain-paths.json"),
  path.join("viberoots", "cache"),
  path.join("viberoots", "codex-test-logs"),
  path.join("viberoots", "coverage"),
  path.join("viberoots", "install-cache"),
  path.join("viberoots", "nix-xdg-cache"),
  path.join("viberoots", "node_modules"),
  path.join("viberoots", "pr-logs"),
  path.join("viberoots", "result"),
  path.join("viberoots", "test-logs"),
  path.join("viberoots", "test-tmp-paths.log"),
  path.join("viberoots", "toolchains", "toolchain_paths.bzl"),
  path.join("viberoots", "xdg-cache"),
];

export function normalizeGeneratedRelPath(relPath: string): string {
  return String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function isGeneratedRepoStateRelPath(relPath: string): boolean {
  const rel = normalizeGeneratedRelPath(relPath);
  if (!rel) return false;
  const base = path.basename(rel);
  if (base.startsWith(".codex-") && base.endsWith(".log")) return true;
  return GENERATED_REPO_STATE_PATHS.some((generatedPath) => {
    const normalized = normalizeGeneratedRelPath(generatedPath);
    return rel === normalized || rel.startsWith(`${normalized}/`);
  });
}

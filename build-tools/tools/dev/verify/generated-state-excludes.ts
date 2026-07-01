import path from "node:path";

export const GENERATED_REPO_STATE_PATHS = [
  ".DS_Store",
  ".codex-logs",
  ".full-test-output.log",
  ".patch-sessions.json",
  path.join(".viberoots", "buck"),
  path.join(".viberoots", "cache"),
  path.join(".viberoots", "codex-logs"),
  path.join(".viberoots", "workspace", "buck"),
  path.join(".viberoots", "workspace", ".viberoots"),
  path.join(".viberoots", "workspace", "codex-test-logs"),
  path.join("build-tools", "tmp"),
  path.join("viberoots", ".cache"),
  path.join("viberoots", ".clinic"),
  path.join("viberoots", ".codex-logs"),
  path.join("viberoots", ".DS_Store"),
  path.join("viberoots", ".direnv"),
  path.join("viberoots", ".full-test-output.log"),
  path.join("viberoots", ".nix-gcroots"),
  path.join("viberoots", ".patch-sessions.json"),
  path.join("viberoots", ".pnpm-store"),
  path.join("viberoots", ".viberoots"),
  path.join("viberoots", "buck-out"),
  path.join("viberoots", "build-tools", "tmp"),
  path.join("viberoots", "coverage"),
  path.join("viberoots", "node_modules"),
  path.join("viberoots", "result"),
  path.join("viberoots", "test-logs"),
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

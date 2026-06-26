import path from "node:path";

export const GENERATED_REPO_STATE_PATHS = [
  path.join(".viberoots", "buck"),
  path.join(".viberoots", "cache"),
  path.join(".viberoots", "codex-logs"),
  path.join(".viberoots", "workspace", "buck"),
  path.join(".viberoots", "workspace", ".viberoots"),
  path.join(".viberoots", "workspace", "codex-test-logs"),
  path.join("build-tools", "tmp"),
  path.join("viberoots", ".viberoots"),
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
  return GENERATED_REPO_STATE_PATHS.some((generatedPath) => {
    const normalized = normalizeGeneratedRelPath(generatedPath);
    return rel === normalized || rel.startsWith(`${normalized}/`);
  });
}

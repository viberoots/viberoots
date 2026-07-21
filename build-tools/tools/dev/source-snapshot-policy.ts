export const SOURCE_SNAPSHOT_EXCLUDES = [
  ".git",
  ".direnv",
  "node_modules",
  "buck-out",
  ".pnpm-store",
  ".pnpm-home",
  ".codex-logs",
  ".nix-gcroots",
  "coverage",
  ".cache",
  ".turbo",
  "dist",
  "build",
  ".vite",
  ".next",
  ".wasm-producer",
  ".viberoots/workspace/.viberoots",
  ".viberoots/workspace/backups",
  ".viberoots/workspace/buck",
  ".viberoots/workspace/cache",
  ".viberoots/workspace/codex-test-logs",
  ".viberoots/workspace/install-cache",
  ".viberoots/workspace/nix-xdg-cache",
  ".viberoots/workspace/node",
  ".viberoots/workspace/pr-logs",
  ".viberoots/workspace/viberoots-flake-input",
  ".viberoots/workspace/xdg-cache",
  ".tmp",
  "tmp",
  "test-logs",
  "result",
];

const ROOT_FILE_EXCLUDES = new Set([".full-test-output.log", ".patch-sessions.json"]);
const ROOT_DIR_EXCLUDES = new Set([
  "backups",
  "cache",
  "codex-test-logs",
  "install-cache",
  "nix-xdg-cache",
  "pr-logs",
  "viberoots-flake-input",
  "xdg-cache",
]);
const VIBEROOTS_ROOT_DIR_EXCLUDES = new Set([
  ".cache",
  ".clinic",
  ".codex-logs",
  ".direnv",
  ".nix-gcroots",
  ".pnpm-store",
  ".viberoots",
  "backups",
  "buck-out",
  "cache",
  "codex-test-logs",
  "coverage",
  "install-cache",
  "nix-xdg-cache",
  "node_modules",
  "pr-logs",
  "result",
  "test-logs",
  "xdg-cache",
]);

export const GRAPH_PATH_IN_SNAPSHOT = [".viberoots", "workspace", "buck", "graph.json"].join("/");

export function forbiddenSnapshotPath(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized === GRAPH_PATH_IN_SNAPSHOT) return false;
  for (const exclude of SOURCE_SNAPSHOT_EXCLUDES) {
    if (!exclude.includes("/")) continue;
    if (normalized === exclude || normalized.startsWith(`${exclude}/`)) return true;
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 1 && ROOT_FILE_EXCLUDES.has(parts[0])) return true;
  if (parts.length === 1 && /^\.codex-.+\.log$/.test(parts[0])) return true;
  if (parts.length === 1 && /^result-.+/.test(parts[0])) return true;
  if (parts.length > 0 && ROOT_DIR_EXCLUDES.has(parts[0])) return true;
  if (
    parts[0] === "viberoots" &&
    parts.length === 2 &&
    (ROOT_FILE_EXCLUDES.has(parts[1]) || /^\.codex-.+\.log$/.test(parts[1]))
  ) {
    return true;
  }
  if (parts[0] === "viberoots" && parts.length > 1 && VIBEROOTS_ROOT_DIR_EXCLUDES.has(parts[1])) {
    return true;
  }
  return parts.some(
    (part, index) =>
      SOURCE_SNAPSHOT_EXCLUDES.includes(part) && (part !== "node_modules" || index === 0),
  );
}

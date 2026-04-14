import * as fsp from "node:fs/promises";

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

function pathRoot(relPath: string): string {
  return (
    normalizePath(relPath)
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "")
      .split("/")[0] || ""
  );
}

const NON_BUILD_SYSTEM_SCOPE_IGNORED_ROOTS = new Set([
  "build-tools",
  "buck-out",
  "node_modules",
  "prelude",
  "third_party",
  "toolchains",
  ".codex",
  ".direnv",
  ".git",
  ".tmp",
  "result",
]);

export function isNonBuildSystemScopeRoot(name: string): boolean {
  const root = pathRoot(name);
  if (!root || root.startsWith(".")) return false;
  return !NON_BUILD_SYSTEM_SCOPE_IGNORED_ROOTS.has(root);
}

export async function resolveNonBuildSystemBuckTargets(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const targets = entries
    .filter((entry) => entry.isDirectory() && isNonBuildSystemScopeRoot(entry.name))
    .map((entry) => `//${entry.name}/...`)
    .sort();
  return targets.length > 0 ? targets : ["//..."];
}

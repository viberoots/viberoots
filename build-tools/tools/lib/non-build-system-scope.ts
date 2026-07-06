import * as fsp from "node:fs/promises";
import path from "node:path";

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
  "viberoots",
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

async function hasBuckPackage(root: string, relRoot: string): Promise<boolean> {
  const absRoot = path.join(root, relRoot);
  const pending = [absRoot];
  while (pending.length > 0) {
    const cur = pending.pop()!;
    const entries = await fsp.readdir(cur, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && (entry.name === "TARGETS" || entry.name === "BUCK")) {
        return true;
      }
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        pending.push(path.join(cur, entry.name));
      }
    }
  }
  return false;
}

async function hasLocalViberootsCell(root: string): Promise<boolean> {
  const currentTarget = await fsp
    .readlink(path.join(root, ".viberoots", "current"))
    .catch(() => "");
  if (currentTarget !== "../viberoots") return false;
  return fsp
    .access(path.join(root, "viberoots", "TARGETS"))
    .then(() => true)
    .catch(() => false);
}

export async function resolveNonBuildSystemBuckTargets(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const targets: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isNonBuildSystemScopeRoot(entry.name)) continue;
    if (await hasBuckPackage(root, entry.name)) {
      targets.push(`//${entry.name}/...`);
    }
  }
  targets.sort();
  if (targets.length === 0 && (await hasLocalViberootsCell(root))) {
    return ["viberoots//..."];
  }
  return targets.length > 0 ? targets : ["//..."];
}

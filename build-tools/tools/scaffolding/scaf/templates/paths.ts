import path from "node:path";
import fs from "node:fs";

function activeSourceRoot(candidate: string): string | null {
  const root = path.resolve(candidate);
  const nested = path.join(root, "viberoots");
  if (fs.existsSync(path.join(nested, "build-tools", "tools", "scaffolding"))) return nested;
  if (fs.existsSync(path.join(root, "build-tools", "tools", "scaffolding"))) return root;
  return null;
}

function moduleSourceRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
}

function sourceRoot(): string {
  const fromModule = moduleSourceRoot();
  const workspaceRoot = String(
    process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "",
  ).trim();
  if (workspaceRoot) {
    const workspaceViberoots = path.join(path.resolve(workspaceRoot), "viberoots");
    if (path.relative(workspaceViberoots, fromModule).startsWith("..") === false) {
      return fromModule;
    }
  }
  for (const envRoot of [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
  ]) {
    const active = envRoot.trim() ? activeSourceRoot(envRoot) : null;
    if (active) return active;
  }
  return fromModule;
}

export function scaffoldingPath(...parts: string[]): string {
  return path.join(sourceRoot(), "build-tools", "tools", "scaffolding", ...parts);
}

export function templateRootPath(...parts: string[]): string {
  return scaffoldingPath("templates", ...parts);
}

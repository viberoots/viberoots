import path from "node:path";
import fs from "node:fs";

function activeRoot(candidate: string): string | null {
  const root = path.resolve(candidate);
  if (fs.existsSync(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))) return root;
  const nested = path.join(root, "viberoots");
  if (fs.existsSync(path.join(nested, "build-tools", "tools", "dev", "zx-init.mjs"))) {
    return nested;
  }
  return null;
}

export function viberootsRoot(): string {
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(process.cwd(), "viberoots"),
    path.join(process.cwd(), ".viberoots", "current"),
    process.cwd(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = activeRoot(candidate);
    if (root) return root;
  }
  return path.resolve(process.cwd());
}

export function viberootsDevTool(name: string): string {
  return path.join(viberootsRoot(), "build-tools", "tools", "dev", name);
}

export function viberootsTool(rel: string): string {
  const normalized = rel.replace(/^viberoots\//, "");
  return path.join(viberootsRoot(), normalized);
}

import path from "node:path";

export function viberootsRoot(): string {
  return path.resolve(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || process.cwd(),
  );
}

export function viberootsDevTool(name: string): string {
  return path.join(viberootsRoot(), "build-tools", "tools", "dev", name);
}

export function viberootsTool(rel: string): string {
  return path.join(viberootsRoot(), rel);
}

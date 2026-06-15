import path from "node:path";

function sourceRoot(): string {
  const envRoot = String(process.env.VIBEROOTS_ROOT || "").trim();
  if (envRoot) return path.resolve(envRoot);
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
}

export function scaffoldingPath(...parts: string[]): string {
  return path.join(sourceRoot(), "build-tools", "tools", "scaffolding", ...parts);
}

export function templateRootPath(...parts: string[]): string {
  return scaffoldingPath("templates", ...parts);
}

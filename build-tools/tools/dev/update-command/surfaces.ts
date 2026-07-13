import * as fsp from "node:fs/promises";
import path from "node:path";

async function exists(file: string): Promise<boolean> {
  return await fsp.access(file).then(
    () => true,
    () => false,
  );
}

export async function projectModuleDirs(root: string, manifest: string): Promise<string[]> {
  const out: string[] = [];
  if (await exists(path.join(root, manifest))) out.push(root);
  for (const base of ["projects/apps", "projects/libs"]) {
    const abs = path.join(root, base);
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && (await exists(path.join(abs, entry.name, manifest)))) {
        out.push(path.join(abs, entry.name));
      }
    }
  }
  return out;
}

export async function hasTrackedCppProjectSurface(root: string): Promise<boolean> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", ["ls-files", "projects"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not inspect tracked C++ project inputs");
  return String(result.stdout || "")
    .split(/\r?\n/)
    .some((file) => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file));
}

export async function unsupportedUpgradeSurfaces(root: string): Promise<string[]> {
  const surfaces: string[] = [];
  if ((await projectModuleDirs(root, "go.mod")).length > 0) surfaces.push("Go");
  if ((await projectModuleDirs(root, "pyproject.toml")).length > 0) surfaces.push("Python/uv");
  if (await hasTrackedCppProjectSurface(root)) surfaces.push("C++");
  return surfaces;
}

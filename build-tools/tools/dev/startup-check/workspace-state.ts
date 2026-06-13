import * as fsp from "node:fs/promises";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

function flakeUsesLocalViberoots(text: string): boolean {
  return /viberoots\.url\s*=\s*"path:\.\/viberoots"/.test(text);
}

async function requireBuckroot(): Promise<void> {
  if (!(await exists(".buckroot"))) throw new Error("[startup-check] .buckroot not found");
}

async function requireLocalViberootsFlake(flakeText: string): Promise<void> {
  if (!flakeUsesLocalViberoots(flakeText)) return;
  if (!(await exists("viberoots/flake.nix"))) {
    throw new Error("[startup-check] local viberoots source is missing viberoots/flake.nix");
  }
}

async function requireLocalCurrentTarget(flakeText: string): Promise<void> {
  if (!flakeUsesLocalViberoots(flakeText)) return;
  try {
    await fsp.lstat(".viberoots/current");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const expectedReal = await fsp.realpath("viberoots");
  let currentReal = "";
  try {
    currentReal = await fsp.realpath(".viberoots/current");
  } catch {
    const target = await fsp.readlink(".viberoots/current");
    throw new Error(
      `[startup-check] .viberoots/current points at ${target}; expected ${expectedReal}`,
    );
  }
  if (currentReal !== expectedReal) {
    throw new Error(
      `[startup-check] .viberoots/current points at ${currentReal}; expected ${expectedReal}`,
    );
  }
}

async function requireBuckconfigCells(buckconfig: string): Promise<void> {
  const values = buckconfig
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes(".viberoots/current"))
    .map((line) => line.split("=", 2)[1]?.trim() || "")
    .filter(Boolean);
  for (const value of values) {
    if (!(await exists(path.resolve(value)))) {
      throw new Error(`[startup-check] .buckconfig references missing cell path: ${value}`);
    }
  }
}

export async function validateStartupWorkspaceState(): Promise<void> {
  await requireBuckroot();
  const flakeText = await readText("flake.nix");
  await requireLocalViberootsFlake(flakeText);
  await requireLocalCurrentTarget(flakeText);

  const buckconfig = await readText(".buckconfig");
  if (!buckconfig) {
    throw new Error(
      "[startup-check] .buckconfig not found; run 'nix develop' to generate it. Exporter will fail without a valid prelude mapping.",
    );
  }
  const hasPrelude = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
  const hasCellsPrelude = /\[cells\][\s\S]*?^\s*prelude\s*=\s*/m.test(buckconfig);
  if (!hasPrelude || !hasCellsPrelude) {
    throw new Error(
      "[startup-check] invalid .buckconfig: missing prelude mapping in [repositories] or [cells]. Run 'nix develop' to provision or fix the mapping.",
    );
  }
  if (!(await exists("prelude/prelude.bzl"))) {
    throw new Error(
      "[startup-check] invalid Buck prelude: prelude/prelude.bzl is missing. Re-enter the dev shell or run a repo wrapper so the prelude symlink can be repaired.",
    );
  }
  await requireBuckconfigCells(buckconfig);
}

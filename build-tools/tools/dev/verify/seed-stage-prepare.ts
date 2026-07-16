import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { PREPARED_MARKER } from "./seed-stage-layout";
import { rewriteStageViberootsInput } from "./seed-stage-flake-input";
import { overlayActiveViberootsIntoStage } from "./seed-stage-source-overlay";

async function gitStageRelPaths(stageDir: string, relPaths: string[]): Promise<void> {
  const existing: string[] = [];
  const forceExisting: string[] = [];
  const missing: string[] = [];
  for (const rel of Array.from(new Set(relPaths)).sort((a, b) => a.localeCompare(b))) {
    const normalized = rel.split(path.sep).join("/");
    const exists = await fsp
      .access(path.join(stageDir, normalized))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      if (normalized.startsWith(".viberoots/")) forceExisting.push(normalized);
      else existing.push(normalized);
    } else {
      missing.push(normalized);
    }
  }
  const git = $({ cwd: stageDir, stdio: "pipe" });
  if (existing.length > 0) await git`git add -- ${existing}`;
  if (forceExisting.length > 0) await git`git add -f -- ${forceExisting}`;
  if (missing.length > 0) await git`git rm -q --ignore-unmatch -- ${missing}`;
}

async function trackedNpmrcDirs(stageDir: string): Promise<string[]> {
  const out = await $({ cwd: stageDir, stdio: "pipe" })`git ls-files -- "**/.npmrc"`
    .nothrow()
    .quiet();
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rel) => path.join(stageDir, path.dirname(rel)));
}

async function ensurePnpmfilePlaceholders(stageDir: string): Promise<string[]> {
  const dirs = new Set<string>([
    stageDir,
    path.join(stageDir, "viberoots"),
    ...(await trackedNpmrcDirs(stageDir)),
  ]);
  const placeholder = "export default {};\n";
  const touched: string[] = [];
  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, ".pnpmfile.mjs");
      await fsp.writeFile(file, placeholder, { flag: "wx" });
      touched.push(path.relative(stageDir, file).split(path.sep).join("/"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
    }
  }
  return touched;
}

export async function prepareStageSeed(stageDir: string, workspaceRoot: string): Promise<void> {
  const touched = [
    ...(await overlayActiveViberootsIntoStage(stageDir, workspaceRoot)),
    ...(await ensurePnpmfilePlaceholders(stageDir)),
    ...(await rewriteStageViberootsInput(stageDir)),
  ];
  if (touched.length > 0) {
    await gitStageRelPaths(stageDir, touched);
    await $({
      cwd: stageDir,
      stdio: "pipe",
    })`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay --allow-empty`
      .nothrow()
      .quiet();
  }
  await fsp.writeFile(path.join(stageDir, PREPARED_MARKER), "ok\n", "utf8");
}

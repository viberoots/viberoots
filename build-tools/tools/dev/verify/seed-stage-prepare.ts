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

async function commitNestedViberoots(stageDir: string): Promise<void> {
  const nested = path.join(stageDir, "viberoots");
  const git = $({
    cwd: nested,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
    },
  });
  const inside = await git`git rev-parse --is-inside-work-tree`.nothrow().quiet();
  const top =
    inside.exitCode === 0 && String(inside.stdout || "").trim() === "true"
      ? String((await git`git rev-parse --show-toplevel`).stdout || "").trim()
      : "";
  if (path.resolve(top || stageDir) !== path.resolve(nested)) {
    await fsp.rm(path.join(nested, ".git"), { recursive: true, force: true });
    await git`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
    await git`git config gc.auto 0`;
  }
  await git`git add -A`;
  const existingHead = await git`git rev-parse --verify HEAD`.nothrow().quiet();
  const changed = await git`git diff --cached --quiet --exit-code`.nothrow().quiet();
  if (existingHead.exitCode !== 0 || changed.exitCode === 1) {
    await git`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-viberoots-overlay --allow-empty`;
  } else if (changed.exitCode !== 0) {
    throw new Error(String(changed.stderr || "nested viberoots staged diff failed"));
  }
  const head = String((await git`git rev-parse HEAD`).stdout || "").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error(`verify seed nested viberoots HEAD is invalid: ${head}`);
  }
  const parent = $({ cwd: stageDir, stdio: "pipe" });
  await parent`git rm -r --cached -q --ignore-unmatch -- viberoots`;
  await parent`git update-index --add --cacheinfo ${`160000,${head},viberoots`}`;
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
    const nestedTouched = touched.some(
      (rel) => rel === "viberoots" || rel.startsWith(`viberoots${path.sep}`),
    );
    if (nestedTouched) await commitNestedViberoots(stageDir);
    await gitStageRelPaths(
      stageDir,
      touched.filter((rel) => rel !== "viberoots" && !rel.startsWith(`viberoots${path.sep}`)),
    );
    await $({
      cwd: stageDir,
      stdio: "pipe",
    })`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay --allow-empty`
      .nothrow()
      .quiet();
  }
  await fsp.writeFile(path.join(stageDir, PREPARED_MARKER), "ok\n", "utf8");
}

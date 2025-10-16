#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { runGlue } from "./glue";
import { deleteSession, findSessionBy, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

function pkgArg(args: string[]): string {
  const p = args[0];
  if (!p) throw new Error("missing <package> name, e.g. lodash or @scope/pkg");
  return p.trim();
}

function pnpmBin(): string {
  const b = (process.env.PNPM_BIN || "").trim();
  return b || "pnpm";
}

function repoRootFromScript(): string {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(scriptDir, "..", "..");
}

async function findImporterDir(args: string[]): Promise<string> {
  const flagIdx = args.findIndex((a) => a === "--importer");
  const repoRoot =
    (process.env.WORKSPACE_ROOT && path.resolve(process.env.WORKSPACE_ROOT)) ||
    repoRootFromScript();

  const hasLock = async (dir: string): Promise<boolean> =>
    await fs.pathExists(path.join(dir, "pnpm-lock.yaml"));

  const resolveCandidate = async (cand: string): Promise<string | null> => {
    const abs = path.isAbsolute(cand) ? cand : path.resolve(repoRoot, cand);
    return (await hasLock(abs)) ? abs : null;
  };

  if (flagIdx >= 0 && args[flagIdx + 1]) {
    const ok = await resolveCandidate(args[flagIdx + 1]);
    if (ok) return ok;
  }
  try {
    const g = (global as any).argv as any;
    if (g && typeof g.importer === "string" && g.importer.trim() !== "") {
      const ok = await resolveCandidate(g.importer);
      if (ok) return ok;
    }
  } catch {}

  // Walk up to detect nearest directory with a pnpm-lock.yaml
  let here = process.cwd();
  while (true) {
    if (await hasLock(here)) return here;
    const next = path.dirname(here);
    if (next === here) break;
    const relToRepo = path.relative(repoRoot, next);
    if (relToRepo.startsWith("..")) break;
    here = next;
  }
  throw new Error(
    "cannot determine importer directory; run inside an importer or pass --importer <dir>",
  );
}

function sessionKey(importerDir: string, pkgName: string): string {
  const root =
    (process.env.WORKSPACE_ROOT && path.resolve(process.env.WORKSPACE_ROOT)) ||
    repoRootFromScript();
  const rel = path.relative(root, importerDir).replace(/\\/g, "/");
  return `${rel || "."}#${pkgName}`.toLowerCase();
}

async function doStart(args: string[]) {
  const pkg = pkgArg(args);
  const importerDir = await findImporterDir(args);
  // pnpm prints the temp directory on stdout; capture it
  const res = await $({ cwd: importerDir, stdio: "pipe" })`${pnpmBin()} patch ${pkg}`;
  const ws =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .pop() || "";
  if (!ws) throw new Error("pnpm patch did not return a workspace path");
  const now = new Date().toISOString();
  const key = sessionKey(importerDir, pkg);
  const rec: SessionRecord = {
    importPath: pkg,
    version: "",
    originPath: importerDir,
    workspacePath: ws,
    createdAt: now,
    updatedAt: now,
  };
  await setSession("node", key, rec);
  console.log(ws);
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: ws })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  const pkg = pkgArg(args);
  const importerDir = await findImporterDir(args);
  const key = sessionKey(importerDir, pkg);
  let sess = await getSession("node", key);
  if (!sess) {
    // Fallback: locate by originPath and package name
    const found = await findSessionBy(
      "node",
      (_k, rec) => rec.originPath === importerDir && rec.importPath === pkg,
    );
    if (found) {
      sess = found.rec;
    }
  }
  if (!sess) {
    // Last-resort: match by package name only (useful in single-session test sandboxes)
    const foundAny = await findSessionBy("node", (_k, rec) => rec.importPath === pkg);
    if (foundAny) {
      sess = foundAny.rec;
    }
  }
  if (!sess) throw new Error(`no active session for ${pkg}; run: patch-pkg start node ${pkg}`);
  await fs.mkdirp(path.join(importerDir, "patches", "node"));
  // Ensure patches-dir is respected; prefer configuration via .npmrc
  await $({ cwd: importerDir })`${pnpmBin()} patch-commit ${sess.workspacePath}`;
  await deleteSession("node", key);
  const prev = process.cwd();
  try {
    process.chdir(repoRootFromScript());
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
}

async function doReset(args: string[]) {
  const pkg = pkgArg(args);
  const importerDir = await findImporterDir(args);
  const key = sessionKey(importerDir, pkg);
  const sess = await getSession("node", key);
  if (!sess) return;
  await deleteSession("node", key);
  try {
    await fs.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doRemove(args: string[]) {
  const pkg = pkgArg(args);
  const importerDir = await findImporterDir(args);
  // Try native pnpm removal first; fall back to editing package.json
  try {
    await $({ cwd: importerDir })`${pnpmBin()} patch-remove ${pkg}`;
  } catch {
    const pkgJsonPath = path.join(importerDir, "package.json");
    try {
      const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
      if (pkgJson.pnpm && pkgJson.pnpm.patchedDependencies) {
        delete pkgJson.pnpm.patchedDependencies[pkg];
        await fs.outputFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf8");
      }
    } catch {}
  }
  const prev = process.cwd();
  try {
    process.chdir(repoRootFromScript());
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
}

async function doSession(args: string[]) {
  const pkg = pkgArg(args);
  await doStart(args);
  console.log("Attached. Ctrl-D to apply, Ctrl-C to reset.");
  await new Promise<void>((resolve, reject) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", async (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "\u0004") {
        try {
          await doApply(args);
          resolve();
        } catch (e) {
          reject(e);
        }
      } else if (s === "\u0003") {
        try {
          await doReset(args);
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

const handler: LanguageHandler = {
  start: doStart,
  apply: doApply,
  reset: doReset,
  session: doSession,
  // @ts-expect-error: extend for node remove support
  remove: doRemove,
};

export default handler;

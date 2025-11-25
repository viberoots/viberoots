#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runGlue } from "./glue";
import { deleteSession, findSessionBy, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";
import { repoRoot } from "./lib/apply";
import { readImporterArg } from "../lib/cli.ts";
import { resolveImporterDir } from "../lib/lockfiles.ts";
import { runSession } from "./lib/session";
import { requirePositional } from "./lib/args";

function pnpmBin(): string {
  const b = (process.env.PNPM_BIN || "").trim();
  return b || "pnpm";
}

function sessionKey(importerDir: string, pkgName: string): string {
  const root = repoRoot();
  const rel = path.relative(root, importerDir).replace(/\\/g, "/");
  return `${rel || "."}#${pkgName}`.toLowerCase();
}

async function doStart(args: string[]) {
  const pkg = requirePositional(args, 0, {
    name: "<package> name",
    example: "lodash or @scope/pkg",
  });
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const importerDir = importerRel === "." ? repoRoot() : path.resolve(repoRoot(), importerRel);
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
  const pkg = requirePositional(args, 0, {
    name: "<package> name",
    example: "lodash or @scope/pkg",
  });
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const importerDir = importerRel === "." ? repoRoot() : path.resolve(repoRoot(), importerRel);
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
  await fsp.mkdir(path.join(importerDir, "patches", "node"), { recursive: true });
  // Ensure patches-dir is respected; prefer configuration via .npmrc
  await $({ cwd: importerDir })`${pnpmBin()} patch-commit ${sess.workspacePath}`;
  await deleteSession("node", key);
  const prev = process.cwd();
  try {
    process.chdir(repoRoot());
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
}

async function doReset(args: string[]) {
  const pkg = requirePositional(args, 0, {
    name: "<package> name",
    example: "lodash or @scope/pkg",
  });
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const importerDir = importerRel === "." ? repoRoot() : path.resolve(repoRoot(), importerRel);
  const key = sessionKey(importerDir, pkg);
  const sess = await getSession("node", key);
  if (!sess) return;
  await deleteSession("node", key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doRemove(args: string[]) {
  const pkg = requirePositional(args, 0, {
    name: "<package> name",
    example: "lodash or @scope/pkg",
  });
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const importerDir = importerRel === "." ? repoRoot() : path.resolve(repoRoot(), importerRel);
  // Try native pnpm removal first; fall back to editing package.json
  try {
    await $({ cwd: importerDir })`${pnpmBin()} patch-remove ${pkg}`;
  } catch {
    const pkgJsonPath = path.join(importerDir, "package.json");
    try {
      const pkgJson = JSON.parse(await fsp.readFile(pkgJsonPath, "utf8"));
      if (pkgJson.pnpm && pkgJson.pnpm.patchedDependencies) {
        delete pkgJson.pnpm.patchedDependencies[pkg];
        await fsp.mkdir(path.dirname(pkgJsonPath), { recursive: true }).catch(() => {});
        await fsp.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf8");
      }
    } catch {}
  }
  const prev = process.cwd();
  try {
    process.chdir(repoRoot());
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
}

async function doSession(args: string[]) {
  await doStart(args);
  await runSession(
    async () => {
      await doApply(args);
    },
    async () => {
      await doReset(args);
    },
  );
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

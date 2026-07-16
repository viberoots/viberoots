#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { readImporterArg } from "../lib/cli";
import { resolveImporterDir } from "../lib/lockfiles";
import { runGlue } from "./glue";
import { repoRoot } from "./lib/apply";
import { requirePositional } from "./lib/args";
import { resolveImporterLocalPatchDir } from "./lib/importer-local-patch-dir";
import { runSession } from "./lib/session";
import { runNodeSyncRequired } from "./node-sync-required";
import { commitNodePatch, removeNodePatch, startNodePatch } from "./patch-node-pnpm";
import {
  deleteSession,
  deleteSessionAtPath,
  findSessionBy,
  findSessionByAtPath,
  getSession,
  getSessionAtPath,
  setSession,
} from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

function sessionKey(importerDir: string, pkgName: string): string {
  const canonical = (p: string): string => {
    const abs = path.resolve(p);
    try {
      return fs.realpathSync.native(abs);
    } catch {
      return abs;
    }
  };
  const root = canonical(repoRoot());
  const importer = canonical(importerDir);
  const rel = path.relative(root, importer).replace(/\\/g, "/");
  return `${rel || "."}#${pkgName}`.toLowerCase();
}

async function findSessionFromNearestStore(args: {
  importerDir: string;
  key: string;
  pkg: string;
}): Promise<{ rec: SessionRecord; moduleKey: string; storeFile: string } | null> {
  let cur = path.resolve(args.importerDir);
  for (;;) {
    const storeFile = path.join(cur, ".patch-sessions.json");
    try {
      await fsp.access(storeFile);
    } catch {
      // ignore
    }
    try {
      const direct = await getSessionAtPath("node", args.key, storeFile);
      if (direct) return { rec: direct, moduleKey: args.key, storeFile };
      const byOrigin = await findSessionByAtPath("node", storeFile, (_k, rec) => {
        return rec.originPath === args.importerDir && rec.importPath === args.pkg;
      });
      if (byOrigin) return { rec: byOrigin.rec, moduleKey: byOrigin.moduleKey, storeFile };
      const byPkg = await findSessionByAtPath(
        "node",
        storeFile,
        (_k, rec) => rec.importPath === args.pkg,
      );
      if (byPkg) return { rec: byPkg.rec, moduleKey: byPkg.moduleKey, storeFile };
    } catch {
      // ignore parse errors while probing alternate stores
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

async function doStart(args: string[]) {
  const pkg = requirePositional(args, 0, {
    name: "<package> name",
    example: "lodash or @scope/pkg",
  });
  const importerRel = await resolveImporterDir(process.cwd(), readImporterArg("") || undefined);
  const importerDir = importerRel === "." ? repoRoot() : path.resolve(repoRoot(), importerRel);
  const res = await startNodePatch(importerDir, pkg);
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
  const root = repoRoot();
  const importerDir = importerRel === "." ? root : path.resolve(root, importerRel);
  const key = sessionKey(importerDir, pkg);
  let sessionKeyUsed = key;
  let sessionStorePath: string | null = null;
  let sess = await getSession("node", key);
  if (!sess) {
    // Fallback: locate by originPath and package name
    const found = await findSessionBy(
      "node",
      (_k, rec) => rec.originPath === importerDir && rec.importPath === pkg,
    );
    if (found) {
      sess = found.rec;
      sessionKeyUsed = found.moduleKey;
    }
  }
  if (!sess) {
    // Last-resort: match by package name only (useful in single-session test sandboxes)
    const foundAny = await findSessionBy("node", (_k, rec) => rec.importPath === pkg);
    if (foundAny) {
      sess = foundAny.rec;
      sessionKeyUsed = foundAny.moduleKey;
    }
  }
  if (!sess) {
    const fallback = await findSessionFromNearestStore({
      importerDir,
      key,
      pkg,
    });
    if (fallback) {
      sess = fallback.rec;
      sessionKeyUsed = fallback.moduleKey;
      sessionStorePath = fallback.storeFile;
    }
  }
  if (!sess) throw new Error(`no active session for ${pkg}; run: patch-pkg start node ${pkg}`);
  const patchDir = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: importerDir,
    lang: "node",
    overridePatchDir: "",
  });
  await fsp.mkdir(patchDir, { recursive: true });
  // Ensure patches-dir is respected; prefer configuration via .npmrc
  await commitNodePatch(importerDir, sess.workspacePath);
  if (sessionStorePath) {
    await deleteSessionAtPath("node", sessionKeyUsed, sessionStorePath);
  } else {
    await deleteSession("node", sessionKeyUsed);
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
    await removeNodePatch(importerDir, pkg);
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
  remove: doRemove,
  syncRequired: runNodeSyncRequired,
};

export default handler;

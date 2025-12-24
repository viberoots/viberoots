#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { LanguageHandler } from "./types";
import { repoRoot } from "./lib/apply";
import { runGlue } from "./glue";
import { readImporterArg, readPatchDirArg } from "../lib/cli.ts";
import { resolvePythonDist } from "./python-dist-resolve";
import { requirePositional } from "./lib/args";
import { resolveImporterLocalPatchDir } from "./lib/importer-local-patch-dir";
import {
  applyWorkspaceWorkflow,
  resetWorkspaceWorkflow,
  startWorkspaceWorkflow,
} from "./lib/workspace-workflow";
import { runSession } from "./lib/session";

function keyFor(dist: string, ver: string): string {
  return `${String(dist || "").toLowerCase()}@${String(ver || "").toLowerCase()}`;
}

async function doStart(args: string[]) {
  const dist = requirePositional(args, 0, {
    name: "<distribution> name",
    example: "requests",
  });
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);
  await startWorkspaceWorkflow({
    lang: "python",
    key,
    importPath: resolved.importPath,
    version: resolved.version,
    originPath: resolved.originPath,
    overrideEnvName: "NIX_PY_DEV_OVERRIDE_JSON",
    echoSnippetEnv: "PATCH_PY_ECHO_SNIPPET",
    moduleKeyForWorkspace: key,
  });
}

async function doApply(args: string[]) {
  const dist = requirePositional(args, 0, {
    name: "<distribution> name",
    example: "requests",
  });
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);

  const root = repoRoot();
  const overridePatchDir = readPatchDirArg("");
  const patchDir = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: resolved.importerDir,
    lang: "python",
    overridePatchDir,
  });
  const dst = path.join(patchDir, `${resolved.importPath}@${resolved.version}.patch`);
  const skipVerify = String(process.env.PATCH_SKIP_VERIFY || "").trim() === "1";
  await applyWorkspaceWorkflow({
    lang: "python",
    key,
    missingSessionError: `no active session for ${key}; run: patch-pkg start python ${dist}`,
    overrideEnvName: "NIX_PY_DEV_OVERRIDE_JSON",
    patchPathAbs: dst,
    verifyMode: "python",
    verifySubjectLabel: "Distribution",
    verifySubjectValue: `${resolved.importPath}@${resolved.version}`,
    forceWrite: true,
    skipVerify,
    afterApply: async () => {
      const prev = process.cwd();
      try {
        process.chdir(root);
        await runGlue();
      } finally {
        try {
          process.chdir(prev);
        } catch {}
      }
    },
  });
}

async function doReset(args: string[]) {
  const dist = requirePositional(args, 0, {
    name: "<distribution> name",
    example: "requests",
  });
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);
  await resetWorkspaceWorkflow({
    lang: "python",
    key,
    overrideEnvName: "NIX_PY_DEV_OVERRIDE_JSON",
  });
}

async function doRemove(args: string[]) {
  const dist = requirePositional(args, 0, {
    name: "<distribution> name",
    example: "requests",
  });
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);

  const root = repoRoot();
  const overridePatchDir = readPatchDirArg("");
  const patchDir = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: resolved.importerDir,
    lang: "python",
    overridePatchDir,
  });
  const dst = path.join(patchDir, `${resolved.importPath}@${resolved.version}.patch`);

  const existed = await fsp
    .access(dst)
    .then(() => true)
    .catch(() => false);
  if (!existed) return;

  await fsp.rm(dst, { force: true });

  // Refresh glue so providers/auto_map reflect the removed patch for the importer.
  const prev = process.cwd();
  try {
    process.chdir(root);
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
}

async function doSession(args: string[]) {
  const dist = requirePositional(args, 0, {
    name: "<distribution> name",
    example: "requests",
  });
  await doStart([dist]);
  await runSession(
    async () => {
      await doApply([dist]);
    },
    async () => {
      await doReset([dist]);
    },
  );
}

const handler: LanguageHandler = {
  start: doStart,
  apply: doApply,
  reset: doReset,
  session: doSession,
};

export default Object.assign({}, handler, { remove: doRemove });

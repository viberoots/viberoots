#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { encodeForPatchFilename } from "../lib/providers";
import { resolveModule } from "./go-module-resolve";
import { parseApplyFlags, repoRoot, resolvePatchDir } from "./lib/apply";
import type { LanguageHandler } from "./types";
import { createDbg, pathExists } from "./lib/util";
import { runSession } from "./lib/session";
import { requirePositional } from "./lib/args";
import {
  applyWorkspaceWorkflow,
  resetWorkspaceWorkflow,
  startWorkspaceWorkflow,
} from "./lib/workspace-workflow";
import { devOverrideEnvNameForLang } from "../lib/dev-override-envs.ts";

const dbg = createDbg("patch-go");

function moduleKey(importPath: string, version: string): string {
  return `${importPath}@${version}`.toLowerCase();
}

async function doStart(args: string[]) {
  dbg("start: proc", { pid: process.pid, cwd: process.cwd() });
  const importPath = requirePositional(args, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  const { version, originPath } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const ws = await startWorkspaceWorkflow({
    lang: "go",
    key,
    importPath,
    version,
    originPath,
    overrideEnvName: devOverrideEnvNameForLang("go"),
    echoSnippetEnv: "PATCH_GO_ECHO_SNIPPET",
    moduleKeyForWorkspace: key,
    deps: { pathExists },
  });
  dbg("start: resolved", { importPath, version, originPath, ws, key });
}

async function doApply(args: string[]) {
  const flags = parseApplyFlags(args);
  const importPath = requirePositional(flags.restArgs, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  dbg("apply: flags", {
    targetPkg: flags.targetPkg,
    overridePatchDir: flags.overridePatchDir,
    importPath,
  });
  const { version } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const enc = encodeForPatchFilename(importPath);
  const root = repoRoot();
  const patchDir = resolvePatchDir("patches/go", flags.targetPkg, flags.overridePatchDir, root);
  const dst = path.join(patchDir, `${enc}@${version}.patch`);
  dbg("apply: paths", { root, patchDir, dst });
  await applyWorkspaceWorkflow({
    lang: "go",
    key,
    missingSessionError: `no active session for ${key}; run: patch-pkg start go ${importPath}`,
    overrideEnvName: devOverrideEnvNameForLang("go"),
    patchPathAbs: dst,
    verifyMode: "go",
    verifySubjectLabel: "Module",
    verifySubjectValue: `${importPath}@${version}`,
    forceWrite: flags.force,
    skipVerify: false,
  });
}

async function doReset(args: string[]) {
  const importPath = requirePositional(args, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  const { version } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  await resetWorkspaceWorkflow({
    lang: "go",
    key,
    overrideEnvName: devOverrideEnvNameForLang("go"),
  });
}

async function doSession(args: string[]) {
  const importPath = requirePositional(args, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  await doStart([importPath]);
  await runSession(
    async () => {
      await doApply([importPath]);
    },
    async () => {
      await doReset([importPath]);
    },
  );
}

async function doRemove(args: string[]) {
  const flags = parseApplyFlags(args);
  const importPath = requirePositional(flags.restArgs, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  const { version } = await resolveModule(importPath);
  const enc = encodeForPatchFilename(importPath);
  const repoRoot = process.env.WORKSPACE_ROOT || process.env.LIVE_ROOT || process.cwd();
  const patchDir =
    flags.overridePatchDir || flags.targetPkg
      ? resolvePatchDir("patches/go", flags.targetPkg, flags.overridePatchDir, repoRoot)
      : path.join(repoRoot, "patches/go");
  try {
    const dst = path.join(patchDir, `${enc}@${version}.patch`);
    await fsp.rm(dst, { force: true });
  } catch {}
}

const handler: LanguageHandler = {
  start: doStart,
  apply: doApply,
  reset: doReset,
  session: doSession,
};

export default Object.assign({}, handler, { remove: doRemove });

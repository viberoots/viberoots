#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { encodeForPatchFilename } from "../lib/providers";
import { makeWorkspace } from "./cross-platform";
import { makeUnifiedDiff } from "./diff";
import { resolveModule } from "./go-module-resolve";
import {
  parseApplyFlags,
  repoRoot,
  resolvePatchDir,
  verifyPatchDryRun,
  writePatchIfChanged,
} from "./lib/apply";
import { deleteSession, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";
import { readOverrideMap, setOverride, clearOverride, printOverrideSnippet } from "./dev-overrides";
import { createDbg, pathExists } from "./lib/util";
import { runSession } from "./lib/session";
import { echoSnippetRequested } from "../lib/cli.ts";
import { requirePositional } from "./lib/args";
import { NOOP_CLEARED_MSG } from "./lib/messages";

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
  const existing = await getSession("go", key);
  if (existing) {
    const workspaceOk = await pathExists(existing.workspacePath);
    const sameOrigin = existing.originPath === originPath;
    if (workspaceOk && sameOrigin) {
      // Reuse only if the workspace still exists AND the origin matches the
      // currently resolved module origin for this invocation. This avoids
      // leaking a prior session created against a different origin into new
      // contexts (e.g., tests with synthetic origins), which would otherwise
      // cause spurious diffs on apply.
      console.log(existing.workspacePath);
      return;
    }
  }
  const ws = await makeWorkspace({ lang: "go", originPath, moduleKey: key });
  dbg("start: resolved", { importPath, version, originPath, ws, key });
  const now = new Date().toISOString();
  const rec: SessionRecord = {
    importPath,
    version,
    originPath,
    workspacePath: ws,
    createdAt: now,
    updatedAt: now,
  };
  await setSession("go", key, rec);
  dbg("start: setSession", { key, ws });
  // Echo snippet parity with C++ when requested; otherwise set in-process env var
  const echoSnippet = echoSnippetRequested({ env: "PATCH_GO_ECHO_SNIPPET" });
  if (echoSnippet) {
    printOverrideSnippet("NIX_GO_DEV_OVERRIDE_JSON", { [key]: ws });
  } else {
    setOverride("NIX_GO_DEV_OVERRIDE_JSON", key, ws);
    dbg("start: setOverride", { key, ws });
  }
  console.log(ws);
  // Optional: open editor if requested (best-effort)
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: ws })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  const flags = parseApplyFlags(args);
  if (flags.force) {
    (global as any).argv = Object.assign({}, (global as any).argv, { force: true });
  }
  const importPath = requirePositional(flags.restArgs, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  dbg("apply: flags", {
    targetPkg: flags.targetPkg,
    overridePatchDir: flags.overridePatchDir,
    importPath,
  });
  const { version, originPath } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const sess = await getSession("go", key);
  if (!sess) throw new Error(`no active session for ${key}; run: patch-pkg start go ${importPath}`);
  const diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  dbg("apply: diff", {
    origin: sess.originPath,
    workspace: sess.workspacePath,
    length: diff ? diff.length : 0,
  });
  if (!diff || diff.trim() === "") {
    // Even on no-op, ensure we clear any dev overrides and end the session to avoid
    // leaking state into subsequent builds/tests.
    const dev = readOverrideMap("NIX_GO_DEV_OVERRIDE_JSON");
    dbg("apply: no-op clearing override", { key, hadOverride: !!dev[key] });
    clearOverride("NIX_GO_DEV_OVERRIDE_JSON", key);
    await deleteSession("go", key);
    dbg("apply: no-op done", { key });
    console.log(NOOP_CLEARED_MSG);
    return;
  }
  const enc = encodeForPatchFilename(importPath);
  const root = repoRoot();
  const patchDir = resolvePatchDir("patches/go", flags.targetPkg, flags.overridePatchDir, root);
  const dst = path.join(patchDir, `${enc}@${version}.patch`);
  dbg("apply: paths", { root, patchDir, dst });
  const wrote = await writePatchIfChanged(dst, diff, !!(global as any).argv?.force);
  if (wrote === "written") {
    console.error(`[patch-go] writing patch: ${dst}`);
  }

  try {
    await verifyPatchDryRun(sess.originPath, dst, "go");
  } catch (e) {
    throw new Error(
      `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin module.\n` +
        `Module: ${importPath}@${version}\n` +
        `Origin: ${sess.originPath}\n` +
        `Patch: ${dst}`,
    );
  }

  clearOverride("NIX_GO_DEV_OVERRIDE_JSON", key);
  await deleteSession("go", key);
  // Keep the temporary workspace on disk to allow downstream builds to
  // point NIX_GO_DEV_OVERRIDE_JSON at it for verification.

  console.log(dst);
}

async function doReset(args: string[]) {
  const importPath = requirePositional(args, 0, {
    name: "<module> import path",
    example: "golang.org/x/net",
  });
  const { version } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const sess = await getSession("go", key);
  if (!sess) return; // no-op
  clearOverride("NIX_GO_DEV_OVERRIDE_JSON", key);
  await deleteSession("go", key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
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

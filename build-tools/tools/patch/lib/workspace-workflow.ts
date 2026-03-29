#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { echoSnippetRequested } from "../../lib/cli.ts";
import { makeWorkspace } from "../cross-platform";
import { setOverride, clearOverride, printOverrideSnippet } from "../dev-overrides";
import { makeUnifiedDiff } from "../diff";
import { deleteSession, getSession, setSession } from "../state";
import type { SessionRecord } from "../types";
import { NOOP_CLEARED_MSG } from "./messages";
import { pathExists } from "./util";
import { verifyPatchDryRun, writePatchIfChanged } from "./apply";

type WorkspaceWorkflowLang = "go" | "python";

type StartOpts = {
  lang: WorkspaceWorkflowLang;
  key: string;
  importPath: string;
  version: string;
  originPath: string;
  overrideEnvName: string;
  echoSnippetEnv: string;
  moduleKeyForWorkspace: string;
  deps?: {
    makeWorkspace?: typeof makeWorkspace;
    pathExists?: typeof pathExists;
  };
};

type ApplyOpts = {
  lang: WorkspaceWorkflowLang;
  key: string;
  missingSessionError: string;
  overrideEnvName: string;
  patchPathAbs: string;
  verifyMode: "go" | "python";
  verifySubjectLabel: "Module" | "Distribution";
  verifySubjectValue: string;
  forceWrite: boolean;
  skipVerify: boolean;
  afterApply?: () => Promise<void>;
  deps?: {
    makeUnifiedDiff?: typeof makeUnifiedDiff;
    verifyPatchDryRun?: typeof verifyPatchDryRun;
    writePatchIfChanged?: typeof writePatchIfChanged;
  };
};

type ResetOpts = {
  lang: WorkspaceWorkflowLang;
  key: string;
  overrideEnvName: string;
};

async function reuseWorkspaceOrNull(
  existing: SessionRecord | null,
  originPath: string,
  exists: typeof pathExists,
): Promise<string | null> {
  if (!existing) return null;
  if (existing.originPath !== originPath) return null;
  if (!(await exists(existing.workspacePath))) return null;
  return existing.workspacePath;
}

async function runPatchEditor(editor: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, {
      cwd,
      stdio: "inherit",
      shell: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(
        new Error(`PATCH_EDITOR exited with code ${String(code)}${signal ? ` (${signal})` : ""}`),
      );
    });
  });
}

export async function startWorkspaceWorkflow(opts: StartOpts): Promise<string> {
  const exists = opts.deps?.pathExists ?? pathExists;
  const mkWs = opts.deps?.makeWorkspace ?? makeWorkspace;

  const existing = await getSession(opts.lang, opts.key);
  const reused = await reuseWorkspaceOrNull(existing, opts.originPath, exists);
  if (reused) {
    console.log(reused);
    return reused;
  }

  const ws = await mkWs({
    lang: opts.lang,
    originPath: opts.originPath,
    moduleKey: opts.moduleKeyForWorkspace,
  });
  const now = new Date().toISOString();
  const rec: SessionRecord = {
    importPath: opts.importPath,
    version: opts.version,
    originPath: opts.originPath,
    workspacePath: ws,
    createdAt: now,
    updatedAt: now,
  };
  await setSession(opts.lang, opts.key, rec);

  const echoSnippet = echoSnippetRequested({ env: opts.echoSnippetEnv });
  if (echoSnippet) {
    printOverrideSnippet(opts.overrideEnvName, { [opts.key]: ws });
  } else {
    setOverride(opts.overrideEnvName, opts.key, ws);
  }

  console.log(ws);
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    try {
      await runPatchEditor(ed, ws);
    } catch {}
  }
  return ws;
}

export async function applyWorkspaceWorkflow(opts: ApplyOpts): Promise<void> {
  const diffFn = opts.deps?.makeUnifiedDiff ?? makeUnifiedDiff;
  const verifyFn = opts.deps?.verifyPatchDryRun ?? verifyPatchDryRun;
  const writeFn = opts.deps?.writePatchIfChanged ?? writePatchIfChanged;

  const sess = await getSession(opts.lang, opts.key);
  if (!sess) throw new Error(opts.missingSessionError);

  const diff = await diffFn(sess.originPath, sess.workspacePath);
  if (!diff || diff.trim() === "") {
    clearOverride(opts.overrideEnvName, opts.key);
    await deleteSession(opts.lang, opts.key);
    console.log(NOOP_CLEARED_MSG);
    return;
  }

  const wrote = await writeFn(opts.patchPathAbs, diff, opts.forceWrite);
  if (wrote === "written") {
    console.error(`[patch-${opts.lang}] writing patch: ${opts.patchPathAbs}`);
  }

  if (!opts.skipVerify) {
    try {
      await verifyFn(sess.originPath, opts.patchPathAbs, opts.verifyMode);
    } catch {
      throw new Error(
        `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin ${opts.verifySubjectLabel.toLowerCase()}.\n` +
          `${opts.verifySubjectLabel}: ${opts.verifySubjectValue}\n` +
          `Origin: ${sess.originPath}\n` +
          `Patch: ${opts.patchPathAbs}`,
      );
    }
  }

  clearOverride(opts.overrideEnvName, opts.key);
  await deleteSession(opts.lang, opts.key);

  if (opts.afterApply) {
    await opts.afterApply();
  }

  console.log(opts.patchPathAbs);
}

export async function resetWorkspaceWorkflow(opts: ResetOpts): Promise<void> {
  const sess = await getSession(opts.lang, opts.key);
  if (!sess) return;
  clearOverride(opts.overrideEnvName, opts.key);
  await deleteSession(opts.lang, opts.key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

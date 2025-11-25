#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { LanguageHandler, SessionRecord } from "./types";
import { makeWorkspace } from "./cross-platform";
import { makeUnifiedDiff } from "./diff";
import { repoRoot } from "./lib/apply";
import { runGlue } from "./glue";
import { readImporterArg, readPatchDirArg } from "../lib/cli.ts";
import { resolvePythonDist } from "./python-dist-resolve";
import { echoSnippetRequested } from "../lib/cli.ts";
import { formatExportSnippet, setOverride, clearOverride, readOverrideMap } from "./dev-overrides";
import { getSession, setSession, deleteSession } from "./state";

function distArg(args: string[]): string {
  const d = args[0];
  if (!d) throw new Error("missing <distribution> name, e.g. requests");
  return d.trim();
}

function keyFor(dist: string, ver: string): string {
  return `${String(dist || "").toLowerCase()}@${String(ver || "").toLowerCase()}`;
}

async function doStart(args: string[]) {
  const dist = distArg(args);
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);

  const existing = await getSession("python", key);
  if (existing) {
    try {
      await fsp.access(existing.workspacePath);
      if (existing.originPath === resolved.originPath) {
        console.log(existing.workspacePath);
        return;
      }
    } catch {
      // fall through and create a new workspace
    }
  }

  const ws = await makeWorkspace({
    lang: "python",
    originPath: resolved.originPath,
    moduleKey: key,
  });
  const now = new Date().toISOString();
  const rec: SessionRecord = {
    importPath: resolved.importPath,
    version: resolved.version,
    originPath: resolved.originPath,
    workspacePath: ws,
    createdAt: now,
    updatedAt: now,
  };
  await setSession("python", key, rec);

  const echoSnippet = echoSnippetRequested({ env: "PATCH_PY_ECHO_SNIPPET" });
  if (echoSnippet) {
    const snippet = formatExportSnippet("NIX_PY_DEV_OVERRIDE_JSON", { [key]: ws });
    try {
      console.error(
        "\nTo build using this workspace as a dev override (local only), run:\n" +
          snippet +
          "\n\nUnset before CI: unset NIX_PY_DEV_OVERRIDE_JSON\n",
      );
    } catch {}
  } else {
    setOverride("NIX_PY_DEV_OVERRIDE_JSON", key, ws);
  }
  console.log(ws);
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: ws })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  const dist = distArg(args);
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);
  const sess = await getSession("python", key);
  if (!sess) throw new Error(`no active session for ${key}; run: patch-pkg start python ${dist}`);

  const diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  if (!diff || diff.trim() === "") {
    const dev = readOverrideMap("NIX_PY_DEV_OVERRIDE_JSON");
    if (dev[key]) clearOverride("NIX_PY_DEV_OVERRIDE_JSON", key);
    await deleteSession("python", key);
    console.log("no changes; no-op (cleared dev overrides and ended session)");
    return;
  }

  const root = repoRoot();
  const overridePatchDir = readPatchDirArg("");
  // Default to importer-local patches directory: <importer>/patches/python
  const defaultImporterLocal = path.isAbsolute(resolved.importerDir)
    ? path.join(resolved.importerDir, "patches", "python")
    : path.join(root, resolved.importerDir, "patches", "python");
  const patchDir = overridePatchDir
    ? path.isAbsolute(overridePatchDir)
      ? overridePatchDir
      : path.join(root, overridePatchDir)
    : defaultImporterLocal;
  await fsp.mkdir(patchDir, { recursive: true });
  const dst = path.join(patchDir, `${resolved.importPath}@${resolved.version}.patch`);
  await fsp.writeFile(dst, diff, "utf8");
  // Best-effort verification that the patch applies cleanly against the origin
  if (String(process.env.PATCH_SKIP_VERIFY || "").trim() !== "1") {
    try {
      const { verifyPatchDryRun } = await import("./lib/apply");
      await verifyPatchDryRun(sess.originPath, dst, "python");
    } catch (e) {
      throw new Error(
        `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin distribution.\n` +
          `Distribution: ${resolved.importPath}@${resolved.version}\n` +
          `Origin: ${sess.originPath}\n` +
          `Patch: ${dst}`,
      );
    }
  }

  // Clear override and end session before running glue
  clearOverride("NIX_PY_DEV_OVERRIDE_JSON", key);
  await deleteSession("python", key);

  // Refresh glue so providers/auto_map reflect the new patch for the importer
  const prev = process.cwd();
  try {
    process.chdir(root);
    await runGlue();
  } finally {
    try {
      process.chdir(prev);
    } catch {}
  }
  console.log(dst);
}

async function doReset(args: string[]) {
  const dist = distArg(args);
  const importerFlag = readImporterArg("");
  const resolved = await resolvePythonDist(dist, importerFlag || undefined);
  const key = keyFor(resolved.importPath, resolved.version);
  const sess = await getSession("python", key);
  if (!sess) return;
  clearOverride("NIX_PY_DEV_OVERRIDE_JSON", key);
  await deleteSession("python", key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doSession(args: string[]) {
  const dist = distArg(args);
  await doStart([dist]);
  // Reuse generic session runner to support Ctrl-D/Ctrl-C behaviors
  const { runSession } = await import("./lib/session");
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

export default handler;

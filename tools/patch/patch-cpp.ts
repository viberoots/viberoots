#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import {
  parseApplyFlags,
  repoRoot,
  resolvePatchDir,
  verifyPatchDryRun,
  writePatchIfChanged,
} from "./lib/apply";
import { deleteSession, getSession, listSessions, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";
import { setOverride, clearOverride, formatExportSnippet } from "./dev-overrides";
import { encodeNixAttrForPatchPrefix, normalizeNixAttr } from "../lib/providers";
import { createDbg, debugEnabled, pathExists } from "./lib/util";
import { runSession } from "./lib/session";
import { resolveNixpkg } from "./cpp/resolve";
import { ensureOriginAndWorkspace } from "./cpp/extract";
import { doApply, doRemove } from "./cpp/apply";
import { echoSnippetRequested } from "../lib/cli.ts";

const dbg = createDbg("patch-cpp");

function attrArg(args: string[]): string {
  const a = (args[0] || "").trim();
  if (!a) throw new Error("missing <attr> nixpkgs attribute, e.g. pkgs.zlib or zlib");
  return a;
}

async function doStart(args: string[]) {
  console.error("[patch-cpp] start: begin");
  dbg("start: proc", { pid: process.pid, cwd: process.cwd() });
  const attrInput = attrArg(args);
  const attrNorm = normalizeNixAttr(attrInput);
  const echoSnippet = echoSnippetRequested({ env: "PATCH_CPP_ECHO_SNIPPET" });
  // Idempotency: if a session already exists and workspace is present, reuse it.
  console.error("[patch-cpp] start: resolve nixpkg", attrNorm);
  const meta = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${meta.version}`.toLowerCase();
  const existing = await getSession("cpp", key);
  if (existing && (await pathExists(existing.workspacePath))) {
    console.error("[patch-cpp] start: reuse existing workspace", existing.workspacePath);
    dbg("start: reuse-session", { key, existing });
    console.log(existing.workspacePath);
    if (echoSnippet) {
      const snippet = formatExportSnippet("NIX_CPP_DEV_OVERRIDE_JSON", {
        [attrNorm]: existing.workspacePath,
      });
      console.error(
        "\nTo build using this workspace as a dev override (local only), run:\n" +
          snippet +
          "\n\nUnset before CI: unset NIX_CPP_DEV_OVERRIDE_JSON\n",
      );
    }
    return;
  }
  console.error("[patch-cpp] start: ensure origin and workspace");
  const { originPath, workspacePath, version } = await ensureOriginAndWorkspace(attrInput, meta);
  const now = new Date().toISOString();
  const rec: SessionRecord = {
    importPath: attrNorm,
    version,
    originPath,
    workspacePath,
    createdAt: now,
    updatedAt: now,
  };
  await setSession("cpp", key, rec);
  console.error("[patch-cpp] start: workspace ready", workspacePath);
  dbg("start: session-set", { key, rec });
  console.log(workspacePath);
  // Default to in-process set; optionally echo a snippet for shells/tools that prefer it
  if (echoSnippet) {
    const snippet = formatExportSnippet("NIX_CPP_DEV_OVERRIDE_JSON", {
      [attrNorm]: workspacePath,
    });
    console.error(
      "\nTo build using this workspace as a dev override (local only), run:\n" +
        snippet +
        "\n\nUnset before CI: unset NIX_CPP_DEV_OVERRIDE_JSON\n",
    );
  } else {
    setOverride("NIX_CPP_DEV_OVERRIDE_JSON", attrNorm, workspacePath);
  }
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: workspacePath })`${ed}`.nothrow();
  }
}

async function doReset(args: string[]) {
  const attrInput = attrArg(args);
  const attrNorm = normalizeNixAttr(attrInput);
  const { version } = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${version}`.toLowerCase();
  const sess = await getSession("cpp", key);
  if (!sess) return; // no-op
  // Clear any process-local dev override for parity
  clearOverride("NIX_CPP_DEV_OVERRIDE_JSON", attrNorm);
  await deleteSession("cpp", key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doSession(args: string[]) {
  const attrInput = attrArg(args);
  await doStart([attrInput]);
  // In session mode, also export a process-local dev override suggestion to help quick rebuilds
  try {
    const attrNorm = normalizeNixAttr(attrInput);
    const { version } = await resolveNixpkg(attrNorm);
    const key = `${attrNorm}@${version}`.toLowerCase();
    const sess = await getSession("cpp", key);
    if (sess?.workspacePath) {
      const json = JSON.stringify({ [attrNorm]: sess.workspacePath });
      console.error(
        "\n[session] You can dev-override locally (do not use in CI):\nexport NIX_CPP_DEV_OVERRIDE_JSON='" +
          json +
          "'\n",
      );
    }
  } catch {}
  await runSession(
    async () => {
      await doApply([attrInput]);
    },
    async () => {
      await doReset([attrInput]);
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

import * as fsp from "node:fs/promises";
import path from "node:path";
import { makeUnifiedDiff } from "../diff";
import {
  parseApplyFlags,
  repoRoot,
  resolvePatchDir,
  verifyPatchDryRun,
  writePatchIfChanged,
} from "../lib/apply";
import { deleteSession, getSession, listSessions } from "../state";
import type { SessionRecord } from "../types";
import { debugEnabled, pathExists } from "../lib/util";
import { encodeNixAttrForPatchPrefix, normalizeNixAttr } from "../../lib/providers";
import { resolveNixpkg } from "./resolve";
import { clearOverride } from "../dev-overrides";
import { devOverrideEnvNameForLang } from "../../lib/dev-override-envs.ts";

export async function doApply(args: string[]) {
  console.error("[patch-cpp] apply: begin");
  const flags = parseApplyFlags(args);
  const attrInput = (flags.restArgs[0] || "").trim();
  if (!attrInput) throw new Error("missing <attr> nixpkgs attribute, e.g. pkgs.zlib or zlib");
  const attrNorm = normalizeNixAttr(attrInput);
  // Avoid redundant nixpkgs resolutions during apply: reuse an existing session.
  // Choose the most recent session for this attr whose workspace still exists; fall back to newest.
  const all = await listSessions("cpp");
  const matches = all.filter((e) => e.rec.importPath === attrNorm);
  let sess: SessionRecord | null = null;
  if (matches.length) {
    // If multiple sessions exist for this attr, prefer the one matching the currently
    // resolved version (when available via test mapping), otherwise fall back to recency.
    let expectedVersion: string | null = null;
    if (matches.length > 1) {
      try {
        const meta = await resolveNixpkg(attrNorm);
        expectedVersion = meta?.version || null;
      } catch {}
    }
    const filtered = expectedVersion
      ? matches.filter(
          (m) => (m.rec.version || "").toLowerCase() === expectedVersion!.toLowerCase(),
        )
      : matches;
    const pickFrom = filtered.length ? filtered : matches;
    // Prefer sessions whose workspacePath exists, sorted by updatedAt desc
    const withWs: Array<SessionRecord & { _t: number }> = [];
    for (const m of pickFrom) {
      try {
        if (await pathExists(m.rec.workspacePath)) {
          const t = Date.parse(m.rec.updatedAt || m.rec.createdAt || "");
          withWs.push(Object.assign({}, m.rec, { _t: isNaN(t) ? 0 : t }));
        }
      } catch {}
    }
    if (withWs.length) {
      withWs.sort((a, b) => b._t - a._t);
      sess = withWs[0] as SessionRecord;
    } else {
      // No existing workspace; fall back to newest by updatedAt
      const byTime = pickFrom
        .map((m) => ({ rec: m.rec, t: Date.parse(m.rec.updatedAt || m.rec.createdAt || "") || 0 }))
        .sort((a, b) => b.t - a.t);
      sess = byTime[0]?.rec || null;
    }
  }
  if (!sess) {
    throw new Error(
      `no active session for ${attrNorm}; run: patch-pkg start cpp ${attrInput} before apply`,
    );
  }
  console.error("[patch-cpp] apply: computing diff");
  let diff = "";
  try {
    diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `failed to compute diff between origin and workspace (is the session stale or paths missing?)\n` +
        `Attr: ${attrNorm}\nVersion: ${sess.version}\nOrigin: ${sess.originPath}\nWorkspace: ${sess.workspacePath}\nError: ${msg}\n` +
        `Hint: If this persists, run 'tools/bin/patch-pkg reset cpp ${attrInput}' and start a new session.`,
    );
  }
  if (!diff || diff.trim() === "") {
    console.log("no changes; no-op");
    return;
  }
  // When debugging, surface concise diagnostics to understand unexpected diffs
  if (debugEnabled()) {
    try {
      const nameStatus = await $({
        stdio: "pipe",
      })`git --no-pager diff --no-index --name-status -- ${sess.originPath} ${sess.workspacePath}`.nothrow();
      console.error(
        "[patch-cpp][debug] diff-name-status:\n" +
          String(nameStatus.stdout || nameStatus.stderr || "").trim(),
      );
    } catch {}
    // List a shallow view of both trees to spot stray files or permissions
    try {
      const listA = await $({
        cwd: sess.originPath,
        stdio: "pipe",
      })`bash --noprofile --norc -c 'find . -maxdepth 2 -type f -ls | sed -n 1,80p'`.nothrow();
      console.error(
        "[patch-cpp][debug] origin-list:\n" + String(listA.stdout || listA.stderr || "").trim(),
      );
    } catch {}
    try {
      const listB = await $({
        cwd: sess.workspacePath,
        stdio: "pipe",
      })`bash --noprofile --norc -c 'find . -maxdepth 2 -type f -ls | sed -n 1,80p'`.nothrow();
      console.error(
        "[patch-cpp][debug] workspace-list:\n" + String(listB.stdout || listB.stderr || "").trim(),
      );
    } catch {}
    try {
      const header = diff.split(/\r?\n/).slice(0, 40).join("\n");
      console.error("[patch-cpp][debug] diff-head:\n" + header);
    } catch {}
  }
  // Emit lightweight debug about the diff (length and first header lines)
  try {
    const header = diff.split(/\r?\n/).slice(0, 10);
    console.error("[patch-cpp] apply: diff-summary", { length: diff.length, lines: header });
  } catch {}

  const fileKey = encodeNixAttrForPatchPrefix(attrNorm);
  const root = repoRoot();
  const patchDir = resolvePatchDir("patches/cpp", flags.targetPkg, flags.overridePatchDir, root);
  const dst = path.join(patchDir, `${fileKey}@${sess.version}.patch`);
  const wrote = await writePatchIfChanged(dst, diff, flags.force);
  if (wrote === "written") {
    console.error("[patch-cpp] apply: wrote patch", dst);
  }
  // Proactively print note so callers capturing stdout see it even if verification chats to tty
  console.log("C++ overlay auto-discovers patches by filename; no manual snippet required.");
  // Verify patch applies with -p1 to pristine origin
  console.error("[patch-cpp] apply: verifying patch");
  try {
    await verifyPatchDryRun(sess.originPath, dst, "cpp");
    console.error("[patch-cpp] apply: verification ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin source.\n` +
        `Attr: ${attrNorm}\n` +
        `Version: ${sess.version}\n` +
        `Origin: ${sess.originPath}\n` +
        `Patch: ${dst}\n` +
        `patch: ${msg}`,
    );
  }

  // End session; keep workspace for manual inspection if desired
  try {
    const key = `${attrNorm}@${sess.version}`.toLowerCase();
    clearOverride(devOverrideEnvNameForLang("cpp"), attrNorm);
    await deleteSession("cpp", key);
  } catch {}
  console.log(dst);
}

export async function doRemove(args: string[]) {
  const flags = parseApplyFlags(args);
  const attrInput = (flags.restArgs[0] || "").trim();
  if (!attrInput) throw new Error("missing <attr> nixpkgs attribute, e.g. pkgs.zlib or zlib");
  const attrNorm = normalizeNixAttr(attrInput);
  // Resolve version using test-friendly fast path when available
  const { version } = await resolveNixpkg(attrNorm);
  const root = repoRoot();
  const patchDir =
    flags.overridePatchDir || flags.targetPkg
      ? resolvePatchDir("patches/cpp", flags.targetPkg, flags.overridePatchDir, root)
      : path.join(root, "patches/cpp");
  const fileKey = encodeNixAttrForPatchPrefix(attrNorm);
  try {
    const dst = path.join(patchDir, `${fileKey}@${version}.patch`);
    await fsp.rm(dst, { force: true });
  } catch {}
}

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeForPatchFilename } from "../lib/providers";
import { makeWorkspace } from "./cross-platform";
import { makeUnifiedDiff } from "./diff";
import { resolveModule } from "./go-module-resolve";
import { deleteSession, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mkdirp(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function outputFile(p: string, data: string, enc: BufferEncoding = "utf8"): Promise<void> {
  await mkdirp(path.dirname(p));
  await fsp.writeFile(p, data, enc);
}

async function copyDir(src: string, dst: string): Promise<void> {
  // Node 16+ provides recursive cp
  await fsp.cp(src, dst, { recursive: true, force: true });
}

function moduleArg(args: string[]): string {
  const m = args[0];
  if (!m) throw new Error("missing <module> import path, e.g. golang.org/x/net");
  return m.trim();
}

function moduleKey(importPath: string, version: string): string {
  return `${importPath}@${version}`.toLowerCase();
}

function readDevOverrides(): Record<string, string> {
  const raw = process.env.NIX_GO_DEV_OVERRIDE_JSON || "";
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeDevOverrides(map: Record<string, string>) {
  process.env.NIX_GO_DEV_OVERRIDE_JSON = JSON.stringify(map);
  if (process.env.CI === "true" && Object.keys(map).length > 0) {
    throw new Error("Dev overrides are forbidden in CI (NIX_GO_DEV_OVERRIDE_JSON is set)");
  }
  if (Object.keys(map).length > 0) {
    console.warn(
      "[OVERRIDES ACTIVE] NIX_GO_DEV_OVERRIDE_JSON is set — local derivations will differ.",
    );
  }
}

async function doStart(args: string[]) {
  const importPath = moduleArg(args);
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
  const ws = await makeWorkspace(originPath, key);
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
  const dev = readDevOverrides();
  dev[key] = ws;
  writeDevOverrides(dev);
  console.log(ws);
  // Optional: open editor if requested (best-effort)
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: ws })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  // Parse optional flags first to support local patch-dir targeting
  let targetPkg = "";
  let overridePatchDir = "";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--target" && i + 1 < args.length) {
      const t = String(args[++i] || "").trim();
      if (t.startsWith("//")) {
        const noCell = t.slice(2);
        targetPkg = noCell.split(":")[0] || "";
      } else {
        targetPkg = t.split(":")[0] || "";
      }
    } else if (a.startsWith("--target=")) {
      const t = a.split("=", 2)[1] || "";
      const val = t.trim();
      if (val.startsWith("//")) {
        const noCell = val.slice(2);
        targetPkg = noCell.split(":")[0] || "";
      } else {
        targetPkg = val.split(":")[0] || "";
      }
    } else if (a === "--patch-dir" && i + 1 < args.length) {
      overridePatchDir = String(args[++i] || "").trim();
    } else if (a.startsWith("--patch-dir=")) {
      overridePatchDir = (a.split("=", 2)[1] || "").trim();
    } else if (a === "--force") {
      (global as any).argv = Object.assign({}, (global as any).argv, { force: true });
    } else if (a.startsWith("--")) {
      // ignore unknown flags here
    } else {
      rest.push(a);
    }
  }
  const importPath = moduleArg(rest);
  const { version, originPath } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const sess = await getSession("go", key);
  if (!sess) throw new Error(`no active session for ${key}; run: patch-pkg start go ${importPath}`);
  const diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  if (!diff || diff.trim() === "") {
    // Even on no-op, ensure we clear any dev overrides and end the session to avoid
    // leaking state into subsequent builds/tests.
    const dev = readDevOverrides();
    delete dev[key];
    writeDevOverrides(dev);
    await deleteSession("go", key);
    console.log("no changes; no-op (cleared dev overrides and ended session)");
    return;
  }
  const enc = encodeForPatchFilename(importPath);
  const repoRoot = process.env.WORKSPACE_ROOT || process.env.LIVE_ROOT || process.cwd();
  let patchDir = "";
  if (overridePatchDir) {
    patchDir = path.isAbsolute(overridePatchDir)
      ? overridePatchDir
      : path.join(repoRoot, overridePatchDir);
  } else if (targetPkg) {
    patchDir = path.join(repoRoot, targetPkg, "patches/go");
  } else {
    throw new Error(
      "missing --target //<pkg>:name or --patch-dir for local patch placement (PR6 local mode)",
    );
  }
  await mkdirp(patchDir);
  const dst = path.join(patchDir, `${enc}@${version}.patch`);
  let write = true;
  if (await pathExists(dst)) {
    const cur = await fsp.readFile(dst, "utf8");
    if (cur === diff) {
      console.log("no-op (already applied)");
      write = false;
    } else if (!(global as any).argv?.force) {
      throw new Error(`${dst} exists with different content. Re-run with --force to overwrite.`);
    }
  }
  if (write) {
    console.error(`[patch-go] writing patch: ${dst}`);
    await outputFile(dst, diff, "utf8");
  }

  // Strict apply verification: ensure patch applies cleanly against origin
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-patch-verify-"));
  const tmpCopy = path.join(tmpRoot, path.basename(sess.originPath));
  await copyDir(sess.originPath, tmpCopy);
  try {
    await $({ cwd: tmpCopy, stdio: "inherit" })`patch -p1 --dry-run -i ${path.resolve(dst)}`;
  } catch (e) {
    throw new Error(
      `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin module.\n` +
        `Module: ${importPath}@${version}\n` +
        `Origin: ${sess.originPath}\n` +
        `Patch: ${dst}`,
    );
  }

  const dev = readDevOverrides();
  delete dev[key];
  writeDevOverrides(dev);
  await deleteSession("go", key);
  // Keep the temporary workspace on disk to allow downstream builds to
  // point NIX_GO_DEV_OVERRIDE_JSON at it for verification.

  console.log(dst);
}

async function doReset(args: string[]) {
  const importPath = moduleArg(args);
  const { version } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const sess = await getSession("go", key);
  if (!sess) return; // no-op
  const dev = readDevOverrides();
  delete dev[key];
  writeDevOverrides(dev);
  await deleteSession("go", key);
  try {
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doSession(args: string[]) {
  const importPath = moduleArg(args);
  await doStart([importPath]);
  console.log("Attached. Ctrl-D to apply, Ctrl-C to reset.");
  await new Promise<void>((resolve, reject) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", async (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "\u0004") {
        // Ctrl-D
        try {
          await doApply([importPath]);
          resolve();
        } catch (e) {
          reject(e);
        }
      } else if (s === "\u0003") {
        // Ctrl-C
        try {
          await doReset([importPath]);
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
};

export default handler;

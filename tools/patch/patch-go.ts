#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { encodeForPatchFilename } from "../lib/providers";
import { makeWorkspace } from "./cross-platform";
import { makeUnifiedDiff } from "./diff";
import { resolveModule } from "./go-module-resolve";
import { deleteSession, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

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

async function ensureGraph(): Promise<void> {
  if (await fs.pathExists("tools/buck/graph.json")) return;
  const nodeBin = process.execPath;
  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const exportScript = path.join(repoRoot, "tools/buck/export-graph.ts");
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
  ];
  try {
    await $`${nodeBin} ${zxArgs} ${exportScript} --out tools/buck/graph.json`;
  } catch (e) {
    throw new Error(
      "tools/buck/graph.json is missing and exporter failed. Ensure buck2 is available in the dev shell and run: tools/buck/export-graph.ts",
    );
  }
}

async function runGlue(): Promise<void> {
  await ensureGraph();
  const nodeBin = process.execPath;
  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const syncScript = path.join(repoRoot, "tools/buck/sync-providers.ts");
  const autoMapScript = path.join(repoRoot, "tools/buck/gen-auto-map.ts");
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
  ];
  await $`${nodeBin} ${zxArgs} ${syncScript}`;
  await $`${nodeBin} ${zxArgs} ${autoMapScript} --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
}

async function doStart(args: string[]) {
  const importPath = moduleArg(args);
  const { version, originPath } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const existing = await getSession("go", key);
  if (existing && (await fs.pathExists(existing.workspacePath))) {
    console.log(existing.workspacePath);
    return;
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
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: ws })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  const importPath = moduleArg(args);
  const { version, originPath } = await resolveModule(importPath);
  const key = moduleKey(importPath, version);
  const sess = await getSession("go", key);
  if (!sess) throw new Error(`no active session for ${key}; run: patch-pkg start go ${importPath}`);
  const diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  if (!diff || diff.trim() === "") {
    console.log("no changes; no-op");
    return;
  }
  await fs.mkdirp("patches/go");
  const enc = encodeForPatchFilename(importPath);
  const dst = path.join("patches", "go", `${enc}@${version}.patch`);
  let write = true;
  if (await fs.pathExists(dst)) {
    const cur = await fs.readFile(dst, "utf8");
    if (cur === diff) {
      console.log("no-op (already applied)");
      write = false;
    } else if (!(global as any).argv.force) {
      throw new Error(`${dst} exists with different content. Re-run with --force to overwrite.`);
    }
  }
  if (write) await fs.outputFile(dst, diff, "utf8");

  // Strict apply verification: ensure patch applies cleanly against origin
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bucknix-patch-verify-"));
  const tmpCopy = path.join(tmpRoot, path.basename(sess.originPath));
  await fs.copy(sess.originPath, tmpCopy, { recursive: true, overwrite: true });
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

  await runGlue();
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
    await fs.rm(sess.workspacePath, { recursive: true, force: true });
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

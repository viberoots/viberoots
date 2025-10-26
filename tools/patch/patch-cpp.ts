#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { makeUnifiedDiff } from "./diff";
import { deleteSession, getSession, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

function attrArg(args: string[]): string {
  const a = (args[0] || "").trim();
  if (!a) throw new Error("missing <attr> nixpkgs attribute, e.g. pkgs.zlib or zlib");
  return a;
}

function normalizeAttr(attr: string): string {
  const s = attr.replace(/^pkgs\./i, "");
  return `pkgs.${s}`;
}

function encodeAttrForFilename(attrNorm: string): string {
  // pkgs.openssl -> pkgs/openssl -> pkgs__openssl
  const slash = attrNorm.replaceAll(".", "/");
  return slash.replaceAll("/", "__");
}

async function nixEvalRaw(expr: string): Promise<string> {
  const { stdout } = await $`nix eval --raw ${expr}`;
  return String(stdout || "").trim();
}

async function resolveNixpkg(
  attrNorm: string,
): Promise<{ pname: string; version: string; srcPath: string }> {
  console.error("[patch-cpp] resolve: begin", attrNorm);
  // Test-only fast path: allow explicit mapping via NIX_CPP_TEST_RESOLVE_JSON
  const testJson = process.env.NIX_CPP_TEST_RESOLVE_JSON || "";
  if (testJson.trim()) {
    try {
      const map = JSON.parse(testJson) as Record<
        string,
        { version: string; srcPath: string; pname?: string }
      >;
      // Accept keys with or without pkgs. prefix
      const keys = [
        attrNorm,
        attrNorm.replace(/^pkgs\./, ""),
        `pkgs.${attrNorm.replace(/^pkgs\./, "")}`,
      ];
      for (const k of keys) {
        const ent = map[k];
        if (ent?.version && ent?.srcPath) {
          const tail = attrNorm.replace(/^pkgs\./, "");
          return { pname: ent.pname || tail, version: ent.version, srcPath: ent.srcPath };
        }
      }
    } catch {}
  }
  // Support flake-style "nixpkgs#<name>" queries by stripping pkgs.
  const name = attrNorm.replace(/^pkgs\./, "");
  const base = `nixpkgs#${name}`;
  let pname = "";
  try {
    console.error("[patch-cpp] resolve: eval pname", base);
    pname = await nixEvalRaw(`${base}.pname`);
  } catch {}
  console.error("[patch-cpp] resolve: eval version", base);
  const version = await nixEvalRaw(`${base}.version`);
  // Ensure the source is realised in the store before attempting to read or extract it.
  console.error("[patch-cpp] resolve: build src", base);
  await $`nix build --no-link ${base}.src`;
  console.error("[patch-cpp] resolve: eval src", base);
  const srcPath = await nixEvalRaw(`${base}.src`);
  console.error("[patch-cpp] resolve: done", { pname: pname || name, version, srcPath });
  return { pname: pname || name, version, srcPath };
}

async function extractOrCopySrc(srcPath: string, destDir: string): Promise<string> {
  await fs.mkdirp(destDir);
  // If srcPath is a directory in the store, copy it. Otherwise, attempt extraction.
  const stat = await fs.stat(srcPath).catch(() => null);
  if (stat && stat.isDirectory()) {
    console.error("[patch-cpp] extract: copy dir", srcPath);
    // Copy store dir into a writable workspace; prefer rsync for portability
    await $`rsync -a ${srcPath}/ ${destDir}/`;
    await $`chmod -R u+w ${destDir}`;
    console.error("[patch-cpp] extract: copy dir done");
    return destDir;
  }

  const lower = srcPath.toLowerCase();
  if (lower.endsWith(".zip")) {
    console.error("[patch-cpp] extract: unzip", srcPath);
    await $({ cwd: destDir })`unzip -qq ${srcPath}`.nothrow();
  } else {
    // Extract the full source to ensure expected headers (e.g., zlib.h) are present
    console.error("[patch-cpp] extract: tar -xf full", srcPath);
    await $({ cwd: destDir })`tar -xf ${srcPath}`.nothrow();
    await $`chmod -R u+w ${destDir}`.nothrow();
  }
  // Heuristic: if extraction created a single directory, descend into it for origin path
  const entries = await fs.readdir(destDir);
  if (entries.length === 1) {
    const only = path.join(destDir, entries[0]);
    const st = await fs.stat(only).catch(() => null);
    if (st && st.isDirectory()) return only;
  }
  console.error("[patch-cpp] extract: done");
  return destDir;
}

async function ensureOriginAndWorkspace(attr: string): Promise<{
  key: string;
  originPath: string;
  workspacePath: string;
  version: string;
  pname: string;
}> {
  const attrNorm = normalizeAttr(attr);
  const { pname, version, srcPath } = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${version}`.toLowerCase();
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const safeKey = encodeAttrForFilename(key);
  const base = path.join(os.tmpdir(), "bucknix-patch-cpp");
  const originRoot = path.join(base, `origin-${safeKey}-${stamp}`);
  const wsRoot = path.join(base, `ws-${safeKey}-${stamp}`);
  await fs.mkdirp(base);
  const originPath = await extractOrCopySrc(srcPath, originRoot);
  // Create workspace by cloning originPath
  await $`rsync -a ${originPath}/ ${wsRoot}/`;
  await $`chmod -R u+w ${wsRoot}`;
  return { key, originPath, workspacePath: wsRoot, version, pname };
}

async function doStart(args: string[]) {
  console.error("[patch-cpp] start: begin");
  const attrInput = attrArg(args);
  const attrNorm = normalizeAttr(attrInput);
  // Idempotency: if a session already exists and workspace is present, reuse it.
  console.error("[patch-cpp] start: resolve nixpkg", attrNorm);
  const meta = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${meta.version}`.toLowerCase();
  const existing = await getSession("cpp", key);
  if (existing && (await fs.pathExists(existing.workspacePath))) {
    console.error("[patch-cpp] start: reuse existing workspace", existing.workspacePath);
    console.log(existing.workspacePath);
    return;
  }
  console.error("[patch-cpp] start: ensure origin and workspace");
  const { originPath, workspacePath, version } = await ensureOriginAndWorkspace(attrInput);
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
  console.log(workspacePath);
  // Suggest a dev override snippet for local iteration parity (unset before CI)
  const snippet = `export NIX_CPP_DEV_OVERRIDE_JSON='${JSON.stringify({ [attrNorm]: workspacePath })}'`;
  console.error(
    "\nTo build using this workspace as a dev override (local only), run:\n" +
      snippet +
      "\n\nUnset before CI: unset NIX_CPP_DEV_OVERRIDE_JSON\n",
  );
  if (process.env.PATCH_EDITOR && process.env.PATCH_EDITOR.trim() !== "") {
    const ed = process.env.PATCH_EDITOR;
    await $({ cwd: workspacePath })`${ed}`.nothrow();
  }
}

async function doApply(args: string[]) {
  console.error("[patch-cpp] apply: begin");
  const attrInput = attrArg(args);
  const attrNorm = normalizeAttr(attrInput);
  console.error("[patch-cpp] apply: resolve nixpkg", attrNorm);
  const { version } = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${version}`.toLowerCase();
  const sess = await getSession("cpp", key);
  if (!sess) throw new Error(`no active session for ${key}; run: patch-pkg start cpp ${attrInput}`);
  console.error("[patch-cpp] apply: computing diff");
  const diff = await makeUnifiedDiff(sess.originPath, sess.workspacePath);
  if (!diff || diff.trim() === "") {
    console.log("no changes; no-op");
    return;
  }

  await fs.mkdirp("patches/cpp");
  const fileKey = encodeAttrForFilename(attrNorm);
  const dst = path.join("patches", "cpp", `${fileKey}@${sess.version}.patch`);

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
  console.error("[patch-cpp] apply: wrote patch", dst);
  // Verify patch applies with -p1 to pristine origin
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bucknix-patch-verify-cpp-"));
  const tmpCopy = path.join(tmpRoot, path.basename(sess.originPath));
  await fs.mkdirp(tmpCopy);
  await $`rsync -a ${sess.originPath}/ ${tmpCopy}/`;
  console.error("[patch-cpp] apply: verifying patch");
  try {
    await $({ cwd: tmpCopy, stdio: "inherit" })`patch -p1 --dry-run -i ${path.resolve(dst)}`;
  } catch (e) {
    throw new Error(
      `Patch verification failed: the generated diff did not apply cleanly with -p1 to the origin source.\n` +
        `Attr: ${attrNorm}\n` +
        `Version: ${sess.version}\n` +
        `Origin: ${sess.originPath}\n` +
        `Patch: ${dst}`,
    );
  }
  console.error("[patch-cpp] apply: verification ok");

  // End session; keep workspace for manual inspection if desired
  await deleteSession("cpp", key);
  // Message: confirmation and path of patch file
  console.log(dst);
  console.log("\nC++ overlay auto-discovers patches by filename; no manual snippet required.\n");
}

async function doReset(args: string[]) {
  const attrInput = attrArg(args);
  const attrNorm = normalizeAttr(attrInput);
  const { version } = await resolveNixpkg(attrNorm);
  const key = `${attrNorm}@${version}`.toLowerCase();
  const sess = await getSession("cpp", key);
  if (!sess) return; // no-op
  await deleteSession("cpp", key);
  try {
    await fs.rm(sess.workspacePath, { recursive: true, force: true });
  } catch {}
}

async function doSession(args: string[]) {
  const attrInput = attrArg(args);
  await doStart([attrInput]);
  console.log("Attached. Ctrl-D to apply, Ctrl-C to reset.");
  // In session mode, also export a process-local dev override suggestion to help quick rebuilds
  try {
    const attrNorm = normalizeAttr(attrInput);
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
  await new Promise<void>((resolve, reject) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", async (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "\u0004") {
        // Ctrl-D
        try {
          await doApply([attrInput]);
          resolve();
        } catch (e) {
          reject(e);
        }
      } else if (s === "\u0003") {
        // Ctrl-C
        try {
          await doReset([attrInput]);
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

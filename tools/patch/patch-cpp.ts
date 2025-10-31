#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeUnifiedDiff } from "./diff";
import { deleteSession, getSession, listSessions, setSession } from "./state";
import type { LanguageHandler, SessionRecord } from "./types";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

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
  const { stdout } = await $`nix eval --raw --accept-flake-config ${expr}`;
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
  console.error("[patch-cpp] resolve: eval version", base);
  const version = await nixEvalRaw(`${base}.version`);
  // Materialize and capture the src path in a single step to avoid a second eval
  console.error("[patch-cpp] resolve: build src", base);
  const built = await $`nix build --no-link --accept-flake-config ${base}.src --print-out-paths`;
  const srcPath =
    String(built.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!srcPath) throw new Error(`failed to resolve src path for ${base}`);
  console.error("[patch-cpp] resolve: eval src", base);
  console.error("[patch-cpp] resolve: done", { pname: name, version, srcPath });
  return { pname: name, version, srcPath };
}

async function extractOrCopySrc(srcPath: string, destDir: string): Promise<string> {
  await fsp.mkdir(destDir, { recursive: true });
  // If srcPath is a directory in the store, copy it. Otherwise, attempt extraction.
  const stat = await fsp.stat(srcPath).catch(() => null);
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
  const entries = await fsp.readdir(destDir);
  if (entries.length === 1) {
    const only = path.join(destDir, entries[0]);
    const st = await fsp.stat(only).catch(() => null);
    if (st && st.isDirectory()) return only;
  }
  console.error("[patch-cpp] extract: done");
  return destDir;
}

async function ensureOriginAndWorkspace(
  attr: string,
  pre?: { pname: string; version: string; srcPath: string },
): Promise<{
  key: string;
  originPath: string;
  workspacePath: string;
  version: string;
  pname: string;
}> {
  const attrNorm = normalizeAttr(attr);
  const { pname, version, srcPath } = pre || (await resolveNixpkg(attrNorm));
  const key = `${attrNorm}@${version}`.toLowerCase();
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const safeKey = encodeAttrForFilename(key);
  const base = path.join(os.tmpdir(), "bucknix-patch-cpp");
  const originRoot = path.join(base, `origin-${safeKey}-${stamp}`);
  const wsRoot = path.join(base, `ws-${safeKey}-${stamp}`);
  await fsp.mkdir(base, { recursive: true });
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
  if (existing && (await pathExists(existing.workspacePath))) {
    console.error("[patch-cpp] start: reuse existing workspace", existing.workspacePath);
    console.log(existing.workspacePath);
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
  // Parse optional flags to support local patch-dir targeting
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
      // ignore unknown flags
    } else {
      rest.push(a);
    }
  }
  const attrInput = attrArg(rest);
  const attrNorm = normalizeAttr(attrInput);
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

  const fileKey = encodeAttrForFilename(attrNorm);
  const repoRoot = process.env.WORKSPACE_ROOT || process.env.LIVE_ROOT || process.cwd();
  let patchDir = "";
  if (overridePatchDir) {
    patchDir = path.isAbsolute(overridePatchDir)
      ? overridePatchDir
      : path.join(repoRoot, overridePatchDir);
  } else if (targetPkg) {
    patchDir = path.join(repoRoot, targetPkg, "patches/cpp");
  } else {
    patchDir = path.join(repoRoot, "patches/cpp");
  }
  await fsp.mkdir(patchDir, { recursive: true });
  const dst = path.join(patchDir, `${fileKey}@${sess.version}.patch`);

  let write = true;
  if (await pathExists(dst)) {
    const cur = await fsp.readFile(dst, "utf8");
    if (cur === diff) {
      console.log("no-op (already applied)");
      write = false;
    } else if (!(global as any).argv.force) {
      throw new Error(`${dst} exists with different content. Re-run with --force to overwrite.`);
    }
  }
  if (write) {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.writeFile(dst, diff, "utf8");
  }
  console.error("[patch-cpp] apply: wrote patch", dst);
  // Verify patch applies with -p1 to pristine origin
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-patch-verify-cpp-"));
  const tmpCopy = path.join(tmpRoot, path.basename(sess.originPath));
  await fsp.mkdir(tmpCopy, { recursive: true });
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
  // Compute the stored key lazily from the session's version
  try {
    const key = `${attrNorm}@${sess.version}`.toLowerCase();
    await deleteSession("cpp", key);
  } catch {}
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
    await fsp.rm(sess.workspacePath, { recursive: true, force: true });
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

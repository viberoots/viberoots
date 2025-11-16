#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { debugEnabled } from "./util";

export type ApplyFlags = {
  targetPkg: string;
  overridePatchDir: string;
  restArgs: string[];
  force: boolean;
};

export function parseApplyFlags(argv: string[]): ApplyFlags {
  let targetPkg = "";
  let overridePatchDir = "";
  let force = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target" && i + 1 < argv.length) {
      const t = String(argv[++i] || "").trim();
      targetPkg = normalizeTargetToPkg(t);
    } else if (a.startsWith("--target=")) {
      const t = a.split("=", 2)[1] || "";
      targetPkg = normalizeTargetToPkg(t.trim());
    } else if (a === "--patch-dir" && i + 1 < argv.length) {
      overridePatchDir = String(argv[++i] || "").trim();
    } else if (a.startsWith("--patch-dir=")) {
      overridePatchDir = (a.split("=", 2)[1] || "").trim();
    } else if (a === "--force") {
      force = true;
    } else if (a.startsWith("--")) {
      // ignore unknown flags
    } else {
      rest.push(a);
    }
  }
  return { targetPkg, overridePatchDir, restArgs: rest, force };
}

function normalizeTargetToPkg(t: string): string {
  if (!t) return "";
  if (t.startsWith("//")) {
    const noCell = t.slice(2);
    return noCell.split(":")[0] || "";
  }
  return t.split(":")[0] || "";
}

export function repoRoot(): string {
  return process.env.WORKSPACE_ROOT || process.env.LIVE_ROOT || process.cwd();
}

export function resolvePatchDir(
  languageSubdir: "patches/go" | "patches/cpp",
  targetPkg: string,
  overridePatchDir: string,
  root = repoRoot(),
): string {
  if (overridePatchDir) {
    return path.isAbsolute(overridePatchDir) ? overridePatchDir : path.join(root, overridePatchDir);
  }
  if (targetPkg) {
    return path.join(root, targetPkg, languageSubdir);
  }
  throw new Error(
    "missing --target //<pkg>:name or --patch-dir for local patch placement (PR6 local mode)",
  );
}

export async function writePatchIfChanged(
  dst: string,
  data: string,
  force: boolean,
): Promise<"no-op" | "written"> {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  try {
    const cur = await fsp.readFile(dst, "utf8");
    if (cur === data) {
      console.log("no-op (already applied)");
      return "no-op";
    }
    if (debugEnabled()) {
      try {
        const curHash = crypto.createHash("sha256").update(cur).digest("hex").slice(0, 12);
        const newHash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 12);
        console.error(
          `[apply][debug] existing patch differs; force=${Boolean(force)} dst=${dst} cur=${curHash} new=${newHash}`,
        );
      } catch {}
    }
    if (!force) {
      throw new Error(`${dst} exists with different content. Re-run with --force to overwrite.`);
    }
  } catch (e: any) {
    // Only fall through when the file truly doesn't exist (ENOENT).
    // If a different error occurred (including our own throw above),
    // rethrow to avoid accidentally overwriting.
    const code = (e && (e as any).code) || "";
    if (code !== "ENOENT") throw e;
  }
  await fsp.writeFile(dst, data, "utf8");
  return "written";
}

async function cpRecursive(src: string, dst: string): Promise<void> {
  await fsp.cp(src, dst, { recursive: true, force: true });
}

export async function verifyPatchDryRun(
  originPath: string,
  patchPath: string,
  mode: "go" | "cpp",
): Promise<void> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `bucknix-patch-verify-${mode}-`));
  const tmpCopy = path.join(tmpRoot, path.basename(originPath));
  if (mode === "cpp") {
    await fsp.mkdir(tmpCopy, { recursive: true });
    await $`rsync -a ${originPath}/ ${tmpCopy}/`;
  } else {
    await cpRecursive(originPath, tmpCopy);
  }
  if (mode === "cpp") {
    // C++ path: run quiet, capture output; mirror existing behavior
    const res = await $({
      cwd: tmpCopy,
      stdio: "pipe",
      env: { ...process.env, LC_ALL: "C" },
    })`patch -s -p1 --dry-run -i ${path.resolve(patchPath)}`.nothrow();
    if ((res.exitCode || 0) !== 0) {
      const stderr = String(res.stderr || "").trim();
      throw new Error(stderr || "patch dry-run failed");
    }
    return;
  }
  // Go path: inherit stdio; throw on failure
  await $({ cwd: tmpCopy, stdio: "inherit" })`patch -p1 --dry-run -i ${path.resolve(patchPath)}`;
}

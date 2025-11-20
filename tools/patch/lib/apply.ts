#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { debugEnabled } from "./util";
import { repoRoot as _repoRoot } from "../../lib/repo.ts";
import {
  readForceFlag,
  readPatchDirArg,
  readTargetArg,
  normalizeTargetToPkg,
} from "../../lib/cli.ts";

export type ApplyFlags = {
  targetPkg: string;
  overridePatchDir: string;
  restArgs: string[];
  force: boolean;
};

export function parseApplyFlags(argv: string[]): ApplyFlags {
  // 1) Parse flags from provided argv (programmatic use in tests)
  let parsedTarget: string | null = null;
  let parsedPatchDir: string | null = null;
  let parsedForce = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] || "";
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    if (a === "--target") {
      const nxt = argv[i + 1] || "";
      if (nxt && !nxt.startsWith("--")) {
        parsedTarget = nxt.trim();
        i++;
      } else {
        parsedTarget = "";
      }
      continue;
    }
    if (a.startsWith("--target=")) {
      parsedTarget = a.slice("--target=".length).trim();
      continue;
    }
    if (a === "--patch-dir" || a === "--patchDir") {
      const nxt = argv[i + 1] || "";
      if (nxt && !nxt.startsWith("--")) {
        parsedPatchDir = nxt.trim();
        i++;
      } else {
        parsedPatchDir = "";
      }
      continue;
    }
    if (a.startsWith("--patch-dir=")) {
      parsedPatchDir = a.slice("--patch-dir=".length).trim();
      continue;
    }
    if (a.startsWith("--patchDir=")) {
      parsedPatchDir = a.slice("--patchDir=".length).trim();
      continue;
    }
    if (a === "--force") {
      parsedForce = true;
      continue;
    }
    // Unknown flags are ignored (dropped from rest) to preserve prior behavior
  }

  // 2) Merge with standardized helpers (CLI invocation via zx/yargs/process.argv)
  const cliTarget = readTargetArg("");
  const cliPatchDir = readPatchDirArg("");
  const cliForce = readForceFlag();

  const targetRaw = (parsedTarget ?? cliTarget) || "";
  const overridePatchDir = (parsedPatchDir ?? cliPatchDir) || "";
  const force = parsedForce || cliForce;

  const targetPkg = normalizeTargetToPkg(targetRaw);
  return { targetPkg, overridePatchDir, restArgs: rest, force };
}

// Re-export unified repo root resolver (keeps existing import sites stable)
export function repoRoot(): string {
  return _repoRoot();
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
  mode: "go" | "cpp" | "python",
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
  // Go/Python path: inherit stdio; throw on failure
  await $({ cwd: tmpCopy, stdio: "inherit" })`patch -p1 --dry-run -i ${path.resolve(patchPath)}`;
}

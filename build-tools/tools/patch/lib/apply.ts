#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { debugEnabled } from "./util";
import { repoRoot as _repoRoot } from "../../lib/repo.ts";
import { copyFileCloneAware, copyTree } from "../../lib/copy-tree.ts";
import { runPatchCommand } from "./command-runner";
import {
  readForceFlag,
  readFlagBoolFromTokens,
  readFlagFromTokens,
  readPatchDirArg,
  removeKnownFlags,
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
  const targetRead = readFlagFromTokens("target", argv);
  const patchDirRead = readFlagFromTokens("patch-dir", argv);
  const patchDirLegacyRead = readFlagFromTokens("patchDir", argv);
  const parsedTarget = targetRead.provided ? targetRead.value.trim() : null;
  const parsedPatchDir = patchDirRead.provided
    ? patchDirRead.value.trim()
    : patchDirLegacyRead.provided
      ? patchDirLegacyRead.value.trim()
      : null;
  const parsedForce = readFlagBoolFromTokens("force", argv);

  // Preserve historical behavior: ignore unknown flags but keep any non-flag tokens
  // (including values following unknown flags) in restArgs.
  const { argv: droppedKnown } = removeKnownFlags(argv, {
    presence: ["--force"],
    takesValue: ["--target", "--patch-dir", "--patchDir"],
  });
  const rest = droppedKnown.filter((t) => !t.startsWith("--"));

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
  throw new Error("missing --target //<pkg>:name or --patch-dir for local patch placement");
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
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await copyTree(src, dst, { cloneMode: "try", force: true });
    return;
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await copyFileCloneAware(src, dst, { cloneMode: "try", force: true });
}

export async function verifyPatchDryRun(
  originPath: string,
  patchPath: string,
  mode: "go" | "cpp" | "python",
): Promise<void> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `bucknix-patch-verify-${mode}-`));
  const tmpCopy = path.join(tmpRoot, path.basename(originPath));
  await cpRecursive(originPath, tmpCopy);
  if (mode === "cpp") {
    // C++ path: run quiet, capture output; mirror existing behavior
    const res = await runPatchCommand(
      "patch",
      ["-s", "-p1", "--dry-run", "-i", path.resolve(patchPath)],
      { cwd: tmpCopy, env: { ...process.env, LC_ALL: "C" } },
    );
    if ((res.code || 0) !== 0) {
      const stderr = String(res.stderr || "").trim();
      throw new Error(stderr || "patch dry-run failed");
    }
    return;
  }
  // Go/Python path: inherit stdio; throw on failure
  const res = await runPatchCommand("patch", ["-p1", "--dry-run", "-i", path.resolve(patchPath)], {
    cwd: tmpCopy,
  });
  if ((res.code || 0) !== 0) {
    const stderr = String(res.stderr || "").trim();
    throw new Error(stderr || "patch dry-run failed");
  }
}

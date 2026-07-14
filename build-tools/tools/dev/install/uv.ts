#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findUvLockfiles } from "../../lib/lockfiles";
import { repoRoot } from "../../lib/repo";
import { absenceCacheFresh, writeAbsenceCache } from "./absence-cache";
import { staleMetadataError } from "./metadata-mode";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);

async function sha256File(file: string): Promise<string> {
  try {
    const buf = await fsp.readFile(file);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Best-effort refresh for Python lock inputs (uv). We don't execute uv here.
 * For now, we surface deterministic diagnostics and a stable place to hook
 * a future uv2nix conversion without changing callers.
 */
export async function runUvRefreshAll(dryRun: boolean, verbose: boolean, readOnly = false) {
  const envRoot = String(process.env.WORKSPACE_ROOT || "").trim();
  const root = envRoot ? path.resolve(envRoot) : repoRoot();
  const scanRoots = ["."];
  if (!dryRun && (await absenceCacheFresh(root, "uv-locks-absent", scanRoots))) {
    if (verbose) console.log("[uv2nix] scan skipped: no uv.lock present");
    return;
  }
  const locks = await findUvLockfiles({ baseRoot: root, roots: ["."] });
  if (!locks.length) {
    if (verbose) console.log("[uv2nix] skip: no uv.lock present");
    if (!dryRun) await writeAbsenceCache(root, "uv-locks-absent", scanRoots);
    return;
  }
  if (dryRun) {
    for (const lf of locks) {
      console.log(`[uv2nix] dry-run: refresh ${lf}`);
    }
    return;
  }
  for (const lf of locks) {
    if (readOnly) {
      const lockPath = path.join(root, lf);
      const manifestPath = path.join(path.dirname(lockPath), "pyproject.toml");
      try {
        await fsp.access(manifestPath);
        await execFileAsync(ensureNixStoreToolPathSync("uv"), ["lock", "--check"], {
          cwd: path.dirname(lockPath),
        });
      } catch (error) {
        const detail = String((error as { stderr?: unknown }).stderr || error);
        throw staleMetadataError(lf, `uv lock consistency check failed: ${detail}`);
      }
    }
    const hash = await sha256File(lf);
    if (verbose) console.log(`[uv2nix] lock ${lf} sha256=${hash || "(unreadable)"}`);
    // Placeholder for future pinned helper invocation (uv/uv2nix):
    // Keep side-effect free for now; backend consumes uv.lock directly.
  }
}

import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdtempNoindex } from "../../../lib/macos-metadata";
import { isGeneratedRepoStateRelPath } from "../../../dev/verify/generated-state-excludes";
import { PREPARED_SEED_MARKER } from "./seed-store-config";
let untrackedOverlayOncePerWorker: Promise<string[]> | null = null;
let trackedOverlayOncePerWorker: Promise<string[]> | null = null;
let overlayFilesOncePerWorker: Promise<string[]> | null = null;

function shouldOverlaySeedFile(rel: string): boolean {
  if (isGeneratedRepoStateRelPath(rel)) return false;
  return (
    rel === "flake.nix" ||
    rel === "flake.lock" ||
    rel.startsWith(".viberoots/") ||
    rel.startsWith("build-tools/") ||
    rel.startsWith("viberoots/")
  );
}

async function listUntrackedFilesOncePerWorker(): Promise<string[]> {
  if (!untrackedOverlayOncePerWorker) {
    untrackedOverlayOncePerWorker = (async () => {
      const out = await $({
        stdio: "pipe",
        cwd: process.cwd(),
      })`git ls-files --others --exclude-standard`
        .nothrow()
        .quiet();
      if (out.exitCode !== 0) return [];
      return String(out.stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter(shouldOverlaySeedFile)
        .sort((a, b) => a.localeCompare(b));
    })();
  }
  return await untrackedOverlayOncePerWorker;
}

async function listTrackedChangedFilesOncePerWorker(): Promise<string[]> {
  if (!trackedOverlayOncePerWorker) {
    trackedOverlayOncePerWorker = (async () => {
      const out = await $({
        stdio: "pipe",
        cwd: process.cwd(),
      })`git status --porcelain=v1 --untracked-files=no`
        .nothrow()
        .quiet();
      if (out.exitCode !== 0) return [];
      const rels = String(out.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const raw = line.length >= 4 ? line.slice(3).trim() : "";
          const renameSep = raw.indexOf(" -> ");
          return (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
        })
        .filter(Boolean)
        .filter(shouldOverlaySeedFile)
        .sort((a, b) => a.localeCompare(b));
      return Array.from(new Set(rels));
    })();
  }
  return await trackedOverlayOncePerWorker;
}

async function listOverlayFilesOncePerWorker(): Promise<string[]> {
  if (!overlayFilesOncePerWorker) {
    overlayFilesOncePerWorker = (async () => {
      const [untracked, tracked] = await Promise.all([
        listUntrackedFilesOncePerWorker(),
        listTrackedChangedFilesOncePerWorker(),
      ]);
      const valid: string[] = [];
      for (const rel of Array.from(new Set([...untracked, ...tracked])).sort()) {
        const st = await fsp.lstat(rel).catch(() => null);
        if (st && !st.isDirectory()) valid.push(rel);
      }
      return valid;
    })();
  }
  return await overlayFilesOncePerWorker;
}

export async function overlayWorktreeIntoTempRepo(tmpDir: string): Promise<string[]> {
  const prepared = await fsp
    .access(path.join(tmpDir, PREPARED_SEED_MARKER))
    .then(() => true)
    .catch(() => false);
  const cached = await listOverlayFilesOncePerWorker();
  const valid: string[] = [];
  for (const rel of cached) {
    if (prepared && rel.startsWith("viberoots/")) continue;
    const st = await fsp.lstat(rel).catch(() => null);
    if (st && !st.isDirectory()) valid.push(rel);
  }
  if (valid.length !== cached.length) overlayFilesOncePerWorker = Promise.resolve(valid);
  if (valid.length === 0) return [];
  const fileList = await mkdtempNoindex(".seed-overlay-", {
    baseName: ".seed-overlay",
    tmpBase: tmpDir,
  });
  const listPath = path.join(fileList, "files.txt");
  await fsp.writeFile(listPath, valid.join("\n") + "\n", "utf8");
  try {
    await $({ cwd: process.cwd() })`rsync -a --relative --files-from ${listPath} ./ ${tmpDir}/`;
  } finally {
    await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
  }
  return valid;
}

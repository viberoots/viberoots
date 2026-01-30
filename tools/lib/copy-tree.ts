#!/usr/bin/env zx-wrapper
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CopyFileCloneMode = "none" | "try" | "force";

type CopyTreeOptions = {
  cloneMode?: CopyFileCloneMode;
  force?: boolean;
};

function cloneFlagForMode(mode: CopyFileCloneMode): number | null {
  if (mode === "none") return null;
  const c: any = (fs as any).constants || {};
  if (mode === "try")
    return typeof c.COPYFILE_FICLONE === "number" ? (c.COPYFILE_FICLONE as number) : null;
  return typeof c.COPYFILE_FICLONE_FORCE === "number" ? (c.COPYFILE_FICLONE_FORCE as number) : null;
}

function isCloneUnsupportedError(e: unknown): boolean {
  const code = (e as any)?.code;
  return (
    code === "EOPNOTSUPP" ||
    code === "ENOTSUP" ||
    code === "ENOSYS" ||
    code === "EXDEV" ||
    code === "EINVAL"
  );
}

async function safeRemoveExisting(dst: string): Promise<void> {
  await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
}

export async function copyFileCloneAware(
  src: string,
  dst: string,
  opts?: { cloneMode?: CopyFileCloneMode; force?: boolean },
): Promise<void> {
  const cloneMode: CopyFileCloneMode = opts?.cloneMode ?? "try";
  if (opts?.force) await safeRemoveExisting(dst);

  const flag = cloneFlagForMode(cloneMode);
  if (flag === null) {
    await fsp.copyFile(src, dst);
    return;
  }
  try {
    await fsp.copyFile(src, dst, flag);
  } catch (e) {
    if (cloneMode === "try" && isCloneUnsupportedError(e)) {
      await fsp.copyFile(src, dst);
      return;
    }
    throw e;
  }
}

export async function copyTree(
  srcRoot: string,
  dstRoot: string,
  opts?: CopyTreeOptions,
): Promise<void> {
  const cloneMode: CopyFileCloneMode = opts?.cloneMode ?? "try";
  if (opts?.force) await safeRemoveExisting(dstRoot);

  const st = await fsp.lstat(srcRoot);
  if (!st.isDirectory()) {
    throw new Error(`copyTree: expected directory source: ${srcRoot}`);
  }
  await fsp.mkdir(dstRoot, { recursive: true });

  const stack: Array<{ src: string; dst: string }> = [{ src: srcRoot, dst: dstRoot }];
  while (stack.length) {
    const cur = stack.pop() as { src: string; dst: string };
    const entries = await fsp.readdir(cur.src, { withFileTypes: true });
    for (const ent of entries) {
      const src = path.join(cur.src, ent.name);
      const dst = path.join(cur.dst, ent.name);

      if (ent.isDirectory()) {
        await fsp.mkdir(dst, { recursive: true });
        stack.push({ src, dst });
        continue;
      }

      if (ent.isFile()) {
        await copyFileCloneAware(src, dst, { cloneMode, force: true });
        continue;
      }

      if (ent.isSymbolicLink()) {
        const link = await fsp.readlink(src);
        await safeRemoveExisting(dst);
        await fsp.symlink(link, dst);
        continue;
      }

      // Avoid silent data loss for unsupported file types.
      throw new Error(`copyTree: unsupported entry type: ${src}`);
    }
  }
}

export async function probeCopyFileCloneSupport(): Promise<boolean> {
  // We use cloneMode="try" (COPYFILE_FICLONE) for seed repo COW cloning. On some platforms
  // COPYFILE_FICLONE_FORCE can be unimplemented (ENOSYS) even when COPYFILE_FICLONE works,
  // so probing "force" would incorrectly disable cloning.
  const tryFlag = cloneFlagForMode("try");
  if (tryFlag === null) return false;

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-clone-probe-"));
  try {
    const src = path.join(dir, "src.txt");
    const dst = path.join(dir, "dst.txt");
    await fsp.writeFile(src, "hello\n", "utf8");
    await fsp.copyFile(src, dst, tryFlag);
    return true;
  } catch (e) {
    if (isCloneUnsupportedError(e)) return false;
    return false;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeCopyFileCloneSupportFrom(args: {
  srcFile: string;
  dstDir: string;
  cloneMode: CopyFileCloneMode;
}): Promise<boolean> {
  const flag = cloneFlagForMode(args.cloneMode);
  if (flag === null) return false;

  const probeDir = await fsp.mkdtemp(path.join(args.dstDir, ".clone-probe-"));
  try {
    const dst = path.join(probeDir, "probe.txt");
    await fsp.copyFile(args.srcFile, dst, flag);
    return true;
  } catch (e) {
    if (isCloneUnsupportedError(e)) return false;
    throw e;
  } finally {
    await fsp.rm(probeDir, { recursive: true, force: true }).catch(() => {});
  }
}

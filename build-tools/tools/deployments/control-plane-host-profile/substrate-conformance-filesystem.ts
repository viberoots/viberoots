#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { CheckResult } from "./substrate-conformance";

export type ExpectedOwner = { expectedUid: number; expectedGid: number };

export async function checkCredentialPermissions(directory: string): Promise<CheckResult> {
  const directoryStat = await fsp.lstat(directory).catch(() => null);
  if (directoryStat?.isSymbolicLink()) {
    return { name: "credential-files", ok: false, detail: "credential directory is a symlink" };
  }
  if (!directoryStat?.isDirectory()) {
    return { name: "credential-files", ok: false, detail: "credential path is not a directory" };
  }
  if ((directoryStat.mode & 0o022) !== 0) {
    return {
      name: "credential-files",
      ok: false,
      detail: "credential directory is group/world writable",
    };
  }
  const entries = await fsp.readdir(directory).catch(() => []);
  if (entries.length === 0) {
    return { name: "credential-files", ok: false, detail: "credential directory is empty" };
  }
  for (const entry of entries) {
    const result = await checkCredentialFile(directory, entry);
    if (!result.ok) return result;
  }
  return { name: "credential-files", ok: true, detail: `${entries.length} entries checked` };
}

export async function checkScratchDirectories(
  directories: string[],
  expectedOwner: ExpectedOwner,
): Promise<CheckResult> {
  if (directories.length === 0) {
    return { name: "scratch-mounts", ok: false, detail: "no scratch directories supplied" };
  }
  for (const directory of directories) {
    const result = await checkScratchDirectory(directory, expectedOwner);
    if (!result.ok) return result;
  }
  return { name: "scratch-mounts", ok: true, detail: `${directories.length} writable mounts` };
}

async function checkCredentialFile(directory: string, entry: string): Promise<CheckResult> {
  const stat = await fsp.lstat(path.join(directory, entry));
  if (stat.isSymbolicLink()) {
    return { name: "credential-files", ok: false, detail: `${entry} is a symlink` };
  }
  if (!stat.isFile()) {
    return { name: "credential-files", ok: false, detail: `${entry} is not a regular file` };
  }
  if ((stat.mode & 0o077) !== 0) {
    return {
      name: "credential-files",
      ok: false,
      detail: `${entry} has group/world permission bits`,
    };
  }
  return { name: "credential-files", ok: true, detail: `${entry} checked` };
}

async function checkScratchDirectory(
  directory: string,
  expectedOwner: ExpectedOwner,
): Promise<CheckResult> {
  const stat = await fsp.lstat(directory).catch(() => null);
  if (stat?.isSymbolicLink()) {
    return { name: "scratch-mounts", ok: false, detail: `${directory} is a symlink` };
  }
  if (!stat?.isDirectory()) {
    return { name: "scratch-mounts", ok: false, detail: `${directory} is not a directory` };
  }
  if (stat.uid !== expectedOwner.expectedUid || stat.gid !== expectedOwner.expectedGid) {
    return {
      name: "scratch-mounts",
      ok: false,
      detail: `${directory} owner ${stat.uid}:${stat.gid} expected ${expectedOwner.expectedUid}:${expectedOwner.expectedGid}`,
    };
  }
  if ((stat.mode & 0o700) !== 0o700 || (stat.mode & 0o022) !== 0) {
    return { name: "scratch-mounts", ok: false, detail: `${directory} has unsafe mode bits` };
  }
  await assertWritable(directory);
  return { name: "scratch-mounts", ok: true, detail: `${directory} checked` };
}

async function assertWritable(directory: string): Promise<void> {
  const probe = path.join(directory, `.vbr-conformance-${process.pid}`);
  await fsp.writeFile(probe, "ok\n", "utf8").catch((error) => {
    throw new Error(`${directory} is not writable: ${errorMessage(error)}`);
  });
  await fsp.rm(probe, { force: true });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

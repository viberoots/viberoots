import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../../lib/macos-metadata";
import { GENERATED_REPO_STATE_PATHS } from "../../../dev/verify/generated-state-excludes";

const requiredFiles = [".buckconfig"];
const requiredFlakeFiles = ["flake.nix", path.join(".viberoots", "workspace", "flake.nix")];
const requiredToolFiles = [
  "viberoots/build-tools/deployments/defs.bzl",
  "viberoots/build-tools/tools/buck/export-graph.ts",
  "viberoots/build-tools/tools/dev/zx-init.mjs",
];
const fastCopyOpts = { stdio: "pipe" as const, reject: false, nothrow: true };
const darwinCloneFileScript = String.raw`
import ctypes
import os
import sys

src = sys.argv[1]
dst = sys.argv[2]
libc = ctypes.CDLL(None, use_errno=True)
clonefile = libc.clonefile
clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
clonefile.restype = ctypes.c_int
rc = clonefile(src.encode(), dst.encode(), 0)
if rc != 0:
    err = ctypes.get_errno()
    raise OSError(err, os.strerror(err), src)
`;
const darwinCloneTreeScript = String.raw`
import ctypes
import os
import stat
import sys

src_root = sys.argv[1]
dst_root = sys.argv[2]
repair_permissions = sys.argv[3] == "1"
libc = ctypes.CDLL(None, use_errno=True)
clonefile = libc.clonefile
clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
clonefile.restype = ctypes.c_int

os.makedirs(dst_root, exist_ok=True)

def clone_regular_file(src, dst):
    rc = clonefile(src.encode(), dst.encode(), 0)
    if rc != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), src)

for cur, dirs, files in os.walk(src_root, topdown=True, followlinks=False):
    rel = os.path.relpath(cur, src_root)
    dst_cur = dst_root if rel == "." else os.path.join(dst_root, rel)
    os.makedirs(dst_cur, exist_ok=True)
    try:
        st = os.lstat(cur)
        if repair_permissions:
            os.chmod(dst_cur, stat.S_IMODE(st.st_mode) | 0o700)
    except OSError:
        pass

    kept_dirs = []
    for name in dirs:
        src = os.path.join(cur, name)
        dst = os.path.join(dst_cur, name)
        st = os.lstat(src)
        if stat.S_ISLNK(st.st_mode):
            os.symlink(os.readlink(src), dst)
        elif stat.S_ISDIR(st.st_mode):
            kept_dirs.append(name)
        else:
            raise RuntimeError(f"unsupported directory entry type: {src}")
    dirs[:] = kept_dirs

    for name in files:
        src = os.path.join(cur, name)
        dst = os.path.join(dst_cur, name)
        st = os.lstat(src)
        if stat.S_ISLNK(st.st_mode):
            os.symlink(os.readlink(src), dst)
            continue
        if not stat.S_ISREG(st.st_mode):
            raise RuntimeError(f"unsupported file type: {src}")
        if os.path.lexists(dst):
            if rel == "." and name == ".metadata_never_index":
                if repair_permissions:
                    os.chmod(dst, stat.S_IMODE(st.st_mode) | 0o600)
                continue
            raise FileExistsError(f"destination already exists: {dst}")
        clone_regular_file(src, dst)
        if repair_permissions:
            os.chmod(dst, stat.S_IMODE(st.st_mode) | 0o600)
`;

async function makeDirectoryPublishable(dir: string): Promise<void> {
  const st = await fsp.stat(dir).catch(() => null);
  if (!st) return;
  await fsp.chmod(dir, st.mode | 0o700).catch(() => {});
}

async function makeTreeWritable(root: string): Promise<void> {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    const st = await fsp.stat(dir).catch(() => null);
    if (st) await fsp.chmod(dir, st.mode | 0o700).catch(() => {});
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) {
        const fileSt = await fsp.stat(abs).catch(() => null);
        if (fileSt) await fsp.chmod(abs, fileSt.mode | 0o600).catch(() => {});
      }
    }
  }
}

export async function missingRequiredSeedFiles(
  dir: string,
  opts: { allowMissingToolRoot?: boolean } = {},
): Promise<string[]> {
  const missing: string[] = [];
  let hasFlake = false;
  for (const rel of requiredFlakeFiles) {
    try {
      await fsp.access(path.join(dir, rel));
      hasFlake = true;
      break;
    } catch {}
  }
  if (!hasFlake) missing.push(requiredFlakeFiles.join(" or "));
  for (const rel of requiredFiles) {
    try {
      await fsp.access(path.join(dir, rel));
    } catch {
      missing.push(rel);
    }
  }
  if (opts.allowMissingToolRoot) return missing;
  for (const rel of requiredToolFiles) {
    const hasStandalone = await fsp
      .access(path.join(dir, rel))
      .then(() => true)
      .catch(() => false);
    if (!hasStandalone) missing.push(rel);
  }
  return missing;
}

export async function assertRequiredSeedFiles(
  dir: string,
  label: string,
  opts: { allowMissingToolRoot?: boolean } = {},
): Promise<void> {
  const missing = await missingRequiredSeedFiles(dir, opts);
  if (missing.length) throw new Error(`runInTemp: ${label} missing ${missing.join(", ")}`);
}

function copyFailureMessage(args: {
  seedPath: string;
  tmpDir: string;
  exitCode: number | null;
  missing: string[];
  sourceMissing: string[];
  stderr: unknown;
  stdout: unknown;
}): string {
  return [
    `runInTemp: CoW seed copy failed before publish: ${args.seedPath} -> ${args.tmpDir}`,
    `exit=${args.exitCode}`,
    `missing=${args.missing.join(", ") || "<none>"}`,
    `sourceMissing=${args.sourceMissing.join(", ") || "<none>"}`,
    `stderr=${String(args.stderr || "").trim() || "<empty>"}`,
    `stdout=${String(args.stdout || "").trim() || "<empty>"}`,
  ].join("\n");
}

async function copyFileCow(
  src: string,
  dst: string,
): Promise<{
  exitCode: number | null;
  stderr: unknown;
  stdout: unknown;
}> {
  await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
  if (process.platform === "darwin") {
    return await $(fastCopyOpts)`python3 -c ${darwinCloneFileScript} ${src} ${dst}`;
  }
  return await $(fastCopyOpts)`cp --reflink=always -p ${src} ${dst}`;
}

export async function probeSeedCowCopyFrom(args: {
  srcFile: string;
  dstDir: string;
}): Promise<boolean> {
  await fsp.mkdir(args.dstDir, { recursive: true });
  const probeDir = await mkdtempNoindex(".seed-copy-probe-", {
    baseName: ".seed-copy-probe",
    tmpBase: args.dstDir,
  });
  const dstFile = path.join(probeDir, "probe.txt");
  try {
    const result = await copyFileCow(args.srcFile, dstFile);
    if (result.exitCode !== 0) return false;
    await fsp.access(dstFile);
    return true;
  } catch {
    return false;
  } finally {
    await fsp.rm(probeDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function copyTreeCow(srcRoot: string, dstRoot: string): Promise<void> {
  const repairPermissions =
    process.platform !== "darwin" ||
    !(await fsp
      .access(path.join(srcRoot, ".seed-store-prepared-v7"))
      .then(() => true)
      .catch(() => false));
  const result =
    process.platform === "darwin"
      ? await $(
          fastCopyOpts,
        )`python3 -c ${darwinCloneTreeScript} ${srcRoot} ${dstRoot} ${repairPermissions ? "1" : "0"}`
      : await $(fastCopyOpts)`cp -a --reflink=always ${`${srcRoot}/.`} ${dstRoot}`;
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `CoW seed tree clone failed: ${srcRoot} -> ${dstRoot}`,
        `exit=${result.exitCode}`,
        `stderr=${String(result.stderr || "").trim() || "<empty>"}`,
        `stdout=${String(result.stdout || "").trim() || "<empty>"}`,
      ].join("\n"),
    );
  }
}

async function removeGeneratedRepoState(root: string): Promise<void> {
  await Promise.all(
    GENERATED_REPO_STATE_PATHS.map(async (rel) => {
      await fsp.rm(path.join(root, rel), { recursive: true, force: true }).catch(() => {});
    }),
  );
}

export async function copySeedStoreToTempRepo(args: {
  seedPath: string;
  tmpDir: string;
}): Promise<void> {
  const stagingDir = `${args.tmpDir}.copying-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  await fsp.rm(args.tmpDir, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  let published = false;
  try {
    await mkdirWithMacosMetadataExclusion(stagingDir);
    let copyError: unknown = null;
    try {
      await copyTreeCow(args.seedPath, stagingDir);
      if (process.platform !== "darwin") {
        await makeTreeWritable(stagingDir);
      }
      await removeGeneratedRepoState(stagingDir);
    } catch (e) {
      copyError = e;
    }
    const missing = await missingRequiredSeedFiles(stagingDir, { allowMissingToolRoot: true });
    if (copyError || missing.length > 0) {
      throw new Error(
        copyFailureMessage({
          ...args,
          exitCode: null,
          missing,
          sourceMissing: await missingRequiredSeedFiles(args.seedPath, {
            allowMissingToolRoot: true,
          }),
          stderr: copyError instanceof Error ? copyError.stack || copyError.message : copyError,
          stdout: "",
        }),
      );
    }
    await makeDirectoryPublishable(stagingDir);
    await fsp.rename(stagingDir, args.tmpDir);
    published = true;
  } finally {
    if (!published) {
      await makeTreeWritable(stagingDir).catch(() => {});
      await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

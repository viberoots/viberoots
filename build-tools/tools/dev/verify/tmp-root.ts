import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

type TmpRootOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  systemTmpRoot?: string;
};

async function writeMacosMetadataNeverIndexMarker(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  await fsp.writeFile(path.join(dir, ".metadata_never_index"), "", "utf8").catch(() => {});
}

export async function ensureRepoLocalTmpRoot(
  root: string,
  opts: TmpRootOptions = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const liveRoot = env.LIVE_ROOT || root;
  const systemTmpRoot = opts.systemTmpRoot ?? "/tmp";
  const legacyRepoTmpdir = path.join(liveRoot, "buck-out", "tmp", "tmpdir");
  let tmpdir = legacyRepoTmpdir;
  const repoLocalTmpdir = platform !== "linux" && platform !== "darwin";
  if (platform === "linux") {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {}
    const suffix = user ? `-${user}` : "";
    tmpdir = path.join(systemTmpRoot, `bucknix-verify${suffix}`, "tmpdir");
    delete env.TEST_TMP_IN_REPO;
  } else if (platform === "darwin") {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {}
    const suffix = user ? `-${user}` : "";
    tmpdir = path.join(systemTmpRoot, `bucknix-verify${suffix}.noindex`, "tmpdir");
    delete env.TEST_TMP_IN_REPO;
  } else {
    env.TEST_TMP_IN_REPO = "1";
  }
  env.TMPDIR = tmpdir;
  if (env.VERIFY_ALLOW_CONCURRENT !== "1") {
    await Promise.all([
      repoLocalTmpdir || platform === "darwin"
        ? fsp.rm(tmpdir, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
      platform === "darwin"
        ? fsp.rm(legacyRepoTmpdir, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
      platform === "darwin"
        ? fsp.rm(`${legacyRepoTmpdir}.noindex`, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
    ]);
  }
  await fsp.mkdir(tmpdir, { recursive: true }).catch(() => {});
  if (platform === "darwin") {
    await Promise.all([
      writeMacosMetadataNeverIndexMarker(path.join(liveRoot, "buck-out")),
      writeMacosMetadataNeverIndexMarker(path.join(liveRoot, "buck-out", "tmp")),
      writeMacosMetadataNeverIndexMarker(path.dirname(tmpdir)),
      writeMacosMetadataNeverIndexMarker(tmpdir),
    ]);
  }
}

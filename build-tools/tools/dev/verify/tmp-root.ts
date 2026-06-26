import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  markMacosMetadataNeverIndex,
  mkdirWithMacosMetadataExclusion,
} from "../../lib/macos-metadata";

type TmpRootOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  systemTmpRoot?: string;
};

export async function ensureRepoLocalTmpRoot(
  root: string,
  opts: TmpRootOptions = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const liveRoot = env.LIVE_ROOT || root;
  const systemTmpRoot = opts.systemTmpRoot ?? "/tmp";
  const staleRepoTmpdir = path.join(liveRoot, "buck-out", "tmp", "tmpdir");
  let tmpdir = staleRepoTmpdir;
  const repoLocalTmpdir = platform !== "linux" && platform !== "darwin";
  if (platform === "linux") {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {}
    const suffix = user ? `-${user}` : "";
    tmpdir = path.join(systemTmpRoot, `viberoots-verify${suffix}`, "tmpdir");
    delete env.TEST_TMP_IN_REPO;
  } else if (platform === "darwin") {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {}
    const suffix = user ? `-${user}` : "";
    tmpdir = path.join(systemTmpRoot, `viberoots-verify${suffix}.noindex`, "tmpdir");
    delete env.TEST_TMP_IN_REPO;
    if (env.VERIFY_ALLOW_CONCURRENT !== "1") {
      await fsp
        .rm(path.join(systemTmpRoot, `viberoots-verify${suffix}`), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
    }
  } else {
    env.TEST_TMP_IN_REPO = "1";
  }
  if (env.VERIFY_ALLOW_CONCURRENT !== "1") {
    await Promise.all([
      repoLocalTmpdir || platform === "darwin"
        ? fsp.rm(tmpdir, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
      platform === "darwin"
        ? fsp.rm(staleRepoTmpdir, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
      platform === "darwin"
        ? fsp.rm(`${staleRepoTmpdir}.noindex`, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve(),
    ]);
  }
  await mkdirWithMacosMetadataExclusion(tmpdir, platform).catch(() => {});
  env.TMPDIR = await fsp.realpath(tmpdir).catch(() => tmpdir);
  if (platform === "darwin") {
    await Promise.all([
      markMacosMetadataNeverIndex(liveRoot, platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".viberoots"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".viberoots", "buck"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".viberoots", "cache"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".viberoots", "workspace"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".viberoots", "workspace", "buck"), platform),
      markMacosMetadataNeverIndex(
        path.join(liveRoot, ".viberoots", "workspace", "buck", "tmp"),
        platform,
      ),
      markMacosMetadataNeverIndex(
        path.join(liveRoot, ".viberoots", "workspace", "buck", "test-logs"),
        platform,
      ),
      markMacosMetadataNeverIndex(
        path.join(liveRoot, ".viberoots", "workspace", "buck", "verify-logs"),
        platform,
      ),
      markMacosMetadataNeverIndex(path.join(liveRoot, ".direnv"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, "buck-out"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, "buck-out", "tmp"), platform),
      markMacosMetadataNeverIndex(path.join(liveRoot, "buck-out", "test-logs"), platform),
      markMacosMetadataNeverIndex(path.dirname(env.TMPDIR), platform),
      markMacosMetadataNeverIndex(env.TMPDIR, platform),
    ]);
  }
}

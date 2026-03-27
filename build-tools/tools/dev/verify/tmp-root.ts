import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export async function ensureRepoLocalTmpRoot(root: string): Promise<void> {
  const liveRoot = process.env.LIVE_ROOT || root;
  let tmpdir = path.join(liveRoot, "buck-out", "tmp", "tmpdir");
  if (process.platform === "linux") {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {}
    const suffix = user ? `-${user}` : "";
    tmpdir = path.join("/tmp", `bucknix-verify${suffix}`, "tmpdir");
    delete process.env.TEST_TMP_IN_REPO;
  } else {
    process.env.TEST_TMP_IN_REPO = "1";
  }
  process.env.TMPDIR = tmpdir;
  await fsp.mkdir(tmpdir, { recursive: true }).catch(() => {});
}

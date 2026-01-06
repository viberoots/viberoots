import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function ensureRepoLocalTmpRoot(root: string): Promise<void> {
  process.env.TEST_TMP_IN_REPO = "1";
  const tmpdir = path.join(process.env.LIVE_ROOT || root, "buck-out", "tmp", "tmpdir");
  process.env.TMPDIR = tmpdir;
  await fsp.mkdir(tmpdir, { recursive: true }).catch(() => {});
}

import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function mktemp(prefix = "test-") {
  const inRepo = process.env.TEST_TMP_IN_REPO === "1";
  const base = inRepo ? path.join(process.cwd(), "buck-out", "tmp") : os.tmpdir();
  if (inRepo) await fsp.mkdir(base, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(base, prefix));
  return await fsp.realpath(tmp).catch(() => tmp);
}

import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  markMacosMetadataNeverIndex,
  mkdirWithMacosMetadataExclusion,
  mkdtempNoindex,
} from "../../../lib/macos-metadata";

export async function mktemp(prefix = "test-") {
  const inRepo = process.env.TEST_TMP_IN_REPO === "1";
  const base = inRepo ? path.join(process.cwd(), "buck-out", "tmp") : os.tmpdir();
  if (inRepo) await mkdirWithMacosMetadataExclusion(base);
  const tmp = inRepo
    ? await fsp.mkdtemp(path.join(base, prefix))
    : await mkdtempNoindex(prefix, { baseName: "viberoots-test-tmp", tmpBase: base });
  await markMacosMetadataNeverIndex(tmp);
  return await fsp.realpath(tmp).catch(() => tmp);
}

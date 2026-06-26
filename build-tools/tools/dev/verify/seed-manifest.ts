import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../../lib/fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";

export async function writeVerifySeedRemoteManifest(opts: {
  root: string;
  seedPath: string;
}): Promise<string> {
  const manifestPath = path.join(
    opts.root,
    "buck-out",
    "tmp",
    "verify-seed",
    "remote-ready-manifest.json",
  );
  await mkdirWithMacosMetadataExclusion(path.dirname(manifestPath)).catch(() => {});
  await writeIfChanged(
    manifestPath,
    JSON.stringify(
      {
        kind: "verify-seed-remote-ready",
        seedPath: opts.seedPath,
        cacheManifest: {
          storePath: opts.seedPath,
        },
      },
      null,
      2,
    ) + "\n",
  );
  return manifestPath;
}

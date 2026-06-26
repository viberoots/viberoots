import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";

export async function prepareVerifyBuckIsolationMetadata(opts: {
  root: string;
  passIso: string;
  nestedIso: string;
  platform?: NodeJS.Platform;
}): Promise<void> {
  const buckOut = path.join(opts.root, "buck-out");
  const dirs = [
    buckOut,
    path.join(buckOut, opts.passIso),
    path.join(buckOut, opts.passIso, "forkserver"),
    path.join(buckOut, opts.passIso, "test-logs"),
    path.join(buckOut, opts.passIso, "tmp"),
    path.join(buckOut, opts.nestedIso),
    path.join(buckOut, opts.nestedIso, "forkserver"),
    path.join(buckOut, opts.nestedIso, "test-logs"),
    path.join(buckOut, opts.nestedIso, "tmp"),
  ];
  for (const dir of dirs) {
    await mkdirWithMacosMetadataExclusion(dir, opts.platform).catch(() => {});
  }
}

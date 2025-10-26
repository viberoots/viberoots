#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { writeIfChanged } from "../../lib/fs-helpers";

export async function syncRustProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const out = opts?.outFile || `third_party/providers/TARGETS.rust.auto`;
  const patchDir = opts?.patchDir || `patches/rust`;
  if (!(await fs.pathExists(patchDir))) {
    await writeIfChanged(out, `# GENERATED FILE — DO NOT EDIT.\n# No patches present for rust.\n`);
    return;
  }
  await writeIfChanged(
    out,
    `# GENERATED FILE — DO NOT EDIT.\n# TODO: implement rust provider sync.\n`,
  );
}

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { writeIfChanged } from "../../lib/fs-helpers";
import { pathExists } from "../../lib/repo.ts";

export async function syncRustProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const out = opts?.outFile || `third_party/providers/TARGETS.rust.auto`;
  const patchDir = opts?.patchDir || `patches/rust`;
  if (!(await pathExists(patchDir))) {
    await writeIfChanged(out, `# GENERATED FILE — DO NOT EDIT.\n# No patches present for rust.\n`);
    return;
  }
  await writeIfChanged(
    out,
    `# GENERATED FILE — DO NOT EDIT.\n# TODO: implement rust provider sync.\n`,
  );
}

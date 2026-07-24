#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { writeIfChanged } from "../../lib/fs-helpers";
import { pathExists } from "../../lib/repo";
import { providerAutoTargetsPath } from "../../lib/workspace-state-paths";

export async function syncRustProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const out = opts?.outFile || providerAutoTargetsPath("rust");
  const patchDir = opts?.patchDir || `patches/rust`;
  const suffix = (await pathExists(patchDir))
    ? " Package-local patches are direct target inputs."
    : "";
  await writeIfChanged(
    out,
    `# GENERATED FILE — DO NOT EDIT.\n# Rust uses no generated providers.${suffix}\n`,
  );
}

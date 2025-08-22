#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { $ } from "zx";

export async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude ".git" --exclude "libs" --exclude ".tmp" ./ ${tmp}/'`;
}

export async function mktemp(prefix = "test-") {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

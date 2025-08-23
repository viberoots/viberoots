#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { $ } from "zx";

export async function rsyncRepoTo(tmp: string) {
  await $`rsync -a --exclude "buck-out" --exclude ".git" --exclude "libs" --exclude ".tmp" ./ ${tmp}/`;
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

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
): Promise<T> {
  const tmp = await mktemp(name + "-");
  await rsyncRepoTo(tmp);
  const _$ = $({ cwd: tmp });
  try {
    return await fn(tmp, _$);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

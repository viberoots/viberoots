#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { $ } from "zx";

export async function rsyncRepoTo(tmp: string) {
  await $`rsync -a --exclude "buck-out" --exclude ".git" --exclude "libs" --exclude ".tmp" --exclude "node_modules" --exclude "coverage" --exclude ".clinic" ./ ${tmp}/`;
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
  // Load direnv environment for the temp dir so devShell linking/PATH are active
  const envOut = await $({
    cwd: tmp,
    stdio: "pipe",
  })`bash -lc 'direnv allow . >/dev/null 2>&1 || true; eval "$(direnv export bash)"; env -0'`;
  const exportEnv: Record<string, string> = { ...process.env };
  for (const entry of String(envOut.stdout || "").split("\0")) {
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx > 0) {
      const k = entry.slice(0, idx);
      const v = entry.slice(idx + 1);
      exportEnv[k] = v;
    }
  }
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    return await fn(tmp, _$);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch((err) => {
      // Non-fatal: cleanup of temp dir may fail on CI; ignore but log for visibility.
      console.warn("warning: failed to remove temp test dir:", err);
    });
  }
}

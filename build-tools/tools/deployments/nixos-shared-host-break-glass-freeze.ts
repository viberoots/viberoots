#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export function breakGlassFreezePath(recordsRoot: string, lockScope: string): string {
  return path.join(path.resolve(recordsRoot), "control-plane", "break-glass-freezes", lockScope);
}

export async function assertNoBreakGlassFreeze(recordsRoot: string, lockScope: string) {
  try {
    await fsp.access(breakGlassFreezePath(recordsRoot, lockScope));
  } catch {
    return;
  }
  throw new Error(`break-glass freeze is active for ${lockScope}`);
}

export async function acquireBreakGlassFreeze(recordsRoot: string, lockScope: string) {
  const freezePath = breakGlassFreezePath(recordsRoot, lockScope);
  await fsp.mkdir(path.dirname(freezePath), { recursive: true });
  await fsp.mkdir(freezePath);
  return {
    freezePath,
    async release() {
      await fsp.rm(freezePath, { recursive: true, force: true });
    },
  };
}

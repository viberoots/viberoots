#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function debugEnabled(): boolean {
  try {
    const pkg = String(process.env.PATCH_PKG_DEBUG || "").trim() === "1";
    const go = String(process.env.PATCH_GO_DEBUG || "").trim() === "1";
    const cpp = String(process.env.PATCH_CPP_DEBUG || "").trim() === "1";
    return pkg || go || cpp;
  } catch {
    return false;
  }
}

export function createDbg(prefix: string): (...args: any[]) => void {
  return (...args: any[]) => {
    if (!debugEnabled()) return;
    try {
      console.error(`[${prefix}][debug]`, ...args);
    } catch {}
  };
}

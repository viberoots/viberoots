#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import type { Adapter } from "../types.ts";

export type ExporterAdapter = Adapter;

function repoPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

export async function loadPresentAdapters(): Promise<Adapter[]> {
  const adapters: Adapter[] = [];
  // Go adapter (optional): only load if file exists to support partial clones
  const goPath = repoPath("tools/buck/exporter/lang/go.ts");
  if (await fs.pathExists(goPath)) {
    const { goAdapter } = await import("./go.ts");
    adapters.push(goAdapter);
  }
  return adapters;
}

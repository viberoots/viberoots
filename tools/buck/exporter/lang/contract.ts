#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import type { Adapter } from "../types.ts";

export type ExporterAdapter = Adapter;

function hereDir(): string {
  return path.dirname(new URL(import.meta.url).pathname);
}

function repoPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

export async function loadPresentAdapters(): Promise<Adapter[]> {
  const adapters: Adapter[] = [];

  // Discover all adapters present next to this file (partial-clone safe)
  const dir = hereDir();
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => f !== "contract.ts")
      .sort();
  } catch {
    files = [];
  }

  for (const f of files) {
    const base = f.replace(/\.ts$/i, "");
    // Require file to exist in repo to support sparse checkouts
    const abs = path.join(dir, f);
    if (!(await fs.pathExists(abs))) continue;
    try {
      const mod = await import(`./${base}.ts`);
      const adapter: Adapter | undefined = (mod &&
        (mod.goAdapter || mod.adapter || mod["default"])) as any;
      if (adapter && typeof adapter.isNode === "function") {
        adapters.push(adapter);
      }
    } catch {
      // Ignore broken or unrelated files; discovery should never fail hard
    }
  }

  // Fallback: legacy explicit Go adapter load (kept for clarity and tests)
  if (adapters.length === 0) {
    const goPath = repoPath("tools/buck/exporter/lang/go.ts");
    if (await fs.pathExists(goPath)) {
      const { goAdapter } = await import("./go.ts");
      adapters.push(goAdapter);
    }
  }

  // Optional filter for tests/diagnostics: limit active adapters via env
  const allow = (process.env.EXPORTER_ADAPTERS || "").trim();
  if (allow) {
    const set = new Set(
      allow
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return adapters.filter((a) => set.has(a.name));
  }
  return adapters;
}

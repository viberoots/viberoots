#!/usr/bin/env zx-wrapper
import path from "node:path";
import { detectEnabledLanguages, type LangSpec } from "../lib/langs";

export type EnabledRegistry = {
  byId: Map<string, LangSpec>;
  list: LangSpec[];
};

export async function loadRegistry(): Promise<EnabledRegistry> {
  // Normalize CWD to repo root so relative paths work consistently
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const root = path.resolve(here, "..", "..", "..");
    process.chdir(root);
  } catch {}
  const list = await detectEnabledLanguages(process.cwd());
  const byId = new Map(list.map((s) => [s.id, s]));
  return { byId, list };
}

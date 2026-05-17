#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "zx";
import type { SprinkleRefLocation, SprinkleRefScheme } from "./sprinkleref-check-types";

const REF_RE = /\b(secret|config|runtime):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g;
const TRAILING = /[),.;\]}>'"`]+$/;
const SKIP_PARTS = new Set([".git", "buck-out", "node_modules", ".direnv", "dist", "build"]);

export type ScannedRef = {
  ref: string;
  scheme: SprinkleRefScheme;
  locations: SprinkleRefLocation[];
};

export async function scanRepositoryRefs(root = process.cwd()): Promise<{
  scannedFiles: number;
  refs: ScannedRef[];
}> {
  const files = (await trackedFiles(root)).filter((file) => !shouldSkip(file));
  const refs = new Map<string, ScannedRef>();
  let scannedFiles = 0;
  for (const file of files) {
    const abs = path.join(root, file);
    const text = await readText(abs);
    if (text === undefined) continue;
    scannedFiles++;
    collectFileRefs(file, text, refs);
  }
  return { scannedFiles, refs: [...refs.values()].sort((a, b) => a.ref.localeCompare(b.ref)) };
}

export function collectFileRefs(
  file: string,
  text: string,
  refs = new Map<string, ScannedRef>(),
): Map<string, ScannedRef> {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const match of lines[index].matchAll(REF_RE)) {
      const ref = match[0].replace(TRAILING, "");
      const scheme = ref.slice(0, ref.indexOf("://")) as SprinkleRefScheme;
      const entry = refs.get(ref) || { ref, scheme, locations: [] };
      entry.locations.push({ file, line: index + 1 });
      refs.set(ref, entry);
    }
  }
  return refs;
}

function shouldSkip(file: string): boolean {
  return file.split(/[\\/]/).some((part) => SKIP_PARTS.has(part));
}

async function trackedFiles(root: string): Promise<string[]> {
  const result = await $({ cwd: root, stdio: "pipe" })`git ls-files -z`
    .quiet()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`git ls-files failed: ${message}`);
    });
  return String(result.stdout || "")
    .split("\0")
    .filter(Boolean);
}

async function readText(file: string): Promise<string | undefined> {
  const data = await fs.readFile(file);
  if (data.includes(0)) return undefined;
  return data.toString("utf8");
}

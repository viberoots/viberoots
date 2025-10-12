#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import crypto from "node:crypto";

export async function writeIfChanged(dst: string, data: string) {
  if (await fs.pathExists(dst)) {
    const cur = await fs.readFile(dst, "utf8");
    const a = crypto.createHash("sha256").update(cur).digest("hex");
    const b = crypto.createHash("sha256").update(data).digest("hex");
    if (a === b) {
      console.log(`no-op (already applied): ${dst}`);
      return;
    }
  }
  await fs.outputFile(dst, data, "utf8");
  console.log("wrote", dst);
}

// Write a deterministic stamp file that captures the content of inputs in a
// stable format. Inputs are de-duplicated by path, sorted by path, and each
// contributes its path marker and content (or a missing marker) to the stamp.
export async function writeStamp(file: string, inputs: Array<{ path: string; content?: string }>) {
  const byPath = new Map<string, string | undefined>();
  for (const i of inputs) {
    const p = String(i.path || "").trim();
    if (!p) continue;
    if (!byPath.has(p)) byPath.set(p, i.content);
  }
  const ordered = Array.from(byPath.entries())
    .map(([p, c]) => ({ path: p, content: c }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const lines: string[] = [];
  for (const it of ordered) {
    lines.push(`# path=${it.path}`);
    if (typeof it.content === "string") {
      lines.push(it.content);
    } else {
      try {
        const txt = await fs.readFile(it.path, "utf8");
        lines.push(txt);
      } catch {
        lines.push(`# missing=${it.path}`);
      }
    }
  }
  await fs.outputFile(file, lines.join("\n"), "utf8");
}

// Stable unique by key while preserving first occurrence order.
export function stableUnique<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

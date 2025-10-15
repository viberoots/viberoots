#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function writeIfChanged(dst: string, data: string) {
  if (await exists(dst)) {
    const cur = await fsp.readFile(dst, "utf8");
    const a = crypto.createHash("sha256").update(cur).digest("hex");
    const b = crypto.createHash("sha256").update(data).digest("hex");
    if (a === b) {
      console.log(`no-op (already applied): ${dst}`);
      return;
    }
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst, data, "utf8");
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
        const txt = await fsp.readFile(it.path, "utf8");
        lines.push(txt);
      } catch {
        lines.push(`# missing=${it.path}`);
      }
    }
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, lines.join("\n"), "utf8");
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

// Render a TARGETS file from a header string and entry strings, ensuring
// deterministic newlines:
// - Header always ends with a single trailing newline
// - If there are entries, the body ends with a single trailing newline
// - Callers control any additional blank lines by including them in `header`
export function renderTargetsFile(header: string, entries: string[]): string {
  if (!entries.length) {
    // Preserve exact header text for empty-state files to avoid unintended diffs.
    return header;
  }
  const headerText = header.endsWith("\n") ? header : header + "\n";
  const body = entries.join("\n");
  const bodyText = body.endsWith("\n") ? body : body + "\n";
  return headerText + bodyText;
}

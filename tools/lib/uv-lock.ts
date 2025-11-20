#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";

// Parse a uv.lock file (TOML-like) and return a set of "<name>@<version>" keys (lowercased).
// Minimal, dependency-free parser that recognizes [[package]] tables with name/version fields.
export async function parseUvLockKeys(file: string): Promise<Set<string>> {
  const txt = await fsp.readFile(file, "utf8");
  const out = new Set<string>();
  // Fast path: tolerate empty or comment-only files
  if (!txt || !/\S/.test(txt)) return out;

  const lines = txt.split(/\r?\n/);
  let curName: string | null = null;
  let curVer: string | null = null;

  function flush() {
    if (curName && curVer) {
      out.add(`${curName.toLowerCase()}@${curVer.toLowerCase()}`);
    }
    curName = null;
    curVer = null;
  }

  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    // New package table
    if (/^\[\[package\]\]/i.test(line)) {
      flush();
      continue;
    }
    // name = "requests"
    let m = /^\s*name\s*=\s*"(.*)"\s*$/i.exec(line);
    if (m) {
      curName = m[1];
      continue;
    }
    // version = "2.32.3"
    m = /^\s*version\s*=\s*"(.*)"\s*$/i.exec(line);
    if (m) {
      curVer = m[1];
      continue;
    }
  }
  // flush final
  flush();
  return out;
}

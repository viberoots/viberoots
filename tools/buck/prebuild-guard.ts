#!/usr/bin/env zx-wrapper
// tools/buck/prebuild-guard.ts
import fs from "fs-extra";

let missing = 0;
const error = (msg: string) => {
  console.error(msg);
  missing = 1;
};

if (!fs.existsSync("tools/buck/graph.json")) {
  error("ERROR: tools/buck/graph.json missing — run export-graph stage first.");
}
if (!fs.existsSync("third_party/providers/auto_map.bzl")) {
  error("ERROR: third_party/providers/auto_map.bzl missing — run gen-auto-map stage.");
}

// Detect if repo has any patches or pnpm lockfiles using git ls-files
try {
  const { stdout } = await $`git ls-files`;
  const files = String(stdout || "")
    .split(/\r?\n/)
    .filter(Boolean);
  const hasPatches = files.some((f) => f.startsWith("patches/") && f.endsWith(".patch"));
  const hasPnpmLocks = files.some((f) => f.endsWith("pnpm-lock.yaml"));
  if (hasPatches || hasPnpmLocks) {
    const exists = fs.existsSync("third_party/providers");
    const hasAuto =
      exists && fs.readdirSync("third_party/providers").some((f) => /^TARGETS.*\.auto$/.test(f));
    if (!hasAuto) {
      error("ERROR: provider files (TARGETS*.auto) missing — run sync-providers stages.");
    }
  }
} catch {
  // If git is unavailable, be conservative and do not block
}

process.exit(missing);

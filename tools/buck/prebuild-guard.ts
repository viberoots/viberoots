#!/usr/bin/env zx-wrapper
// tools/buck/prebuild-guard.ts
import fs from "fs-extra";
import { globby } from "globby";

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

const matches = await globby(["patches/**/*.patch", "**/pnpm-lock.yaml"], { gitignore: true });
const patchesPresent = matches.length > 0;
if (patchesPresent) {
  const exists = fs.existsSync("third_party/providers");
  const hasAuto =
    exists && fs.readdirSync("third_party/providers").some((f) => /^TARGETS.*\.auto$/.test(f));
  if (!hasAuto) {
    error("ERROR: provider files (TARGETS*.auto) missing — run sync-providers stages.");
  }
}

process.exit(missing);

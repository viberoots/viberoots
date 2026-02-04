#!/usr/bin/env zx-wrapper
// build-tools/tools/tests/python/defs_python.exists.test.ts
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

async function main() {
  await runInTemp("defs-python-exists", async (tmp, $) => {
    const filePath = path.join(tmp, "third_party", "providers", "defs_python.bzl");
    if (!(await fs.pathExists(filePath))) {
      console.error("defs_python.bzl missing at", filePath);
      process.exit(2);
    }
    const txt = await fs.readFile(filePath, "utf8");
    if (!/def\s+python_importer_deps\(/.test(txt)) {
      console.error("defs_python.bzl missing python_importer_deps function");
      process.exit(2);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

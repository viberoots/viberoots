#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import fg from "fast-glob";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("only //lang/* may load //lang:importer_wiring_primitives.bzl", async () => {
  const files = await fg(["**/*.bzl"], {
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ["lang/**", "prelude/**", "buck-out/**", "node_modules/**", "coverage/**"],
  });

  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    assert(
      !txt.includes('load("//lang:importer_wiring_primitives.bzl"'),
      `${file} must not load //lang:importer_wiring_primitives.bzl; use //lang:defs_common.bzl or //lang:importer_wiring.bzl`,
    );
  }
});

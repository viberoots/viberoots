#!/usr/bin/env zx-wrapper
import fg from "fast-glob";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("only //viberoots/build-tools/lang/* may load internal importer wiring primitives", async () => {
  const files = await fg(["**/*.bzl"], {
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [
      "viberoots/build-tools/lang/**",
      "prelude/**",
      "buck-out/**",
      "node_modules/**",
      "coverage/**",
    ],
  });

  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    const oldPath = 'load("@viberoots//build-tools/lang:importer_wiring_primitives.bzl"';
    const internalPath =
      'load("//viberoots/build-tools/lang/internal:importer_wiring_primitives.bzl"';
    assert(
      !txt.includes(oldPath) && !txt.includes(internalPath),
      `${file} must not load importer wiring primitives; use @viberoots//build-tools/lang:language_wiring.bzl:prepare_language_wiring(...)`,
    );
  }
});

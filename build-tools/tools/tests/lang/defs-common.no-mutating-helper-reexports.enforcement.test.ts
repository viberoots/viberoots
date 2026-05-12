#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("//build-tools/lang:defs_common.bzl must not re-export removed mutating helpers", async () => {
  const txt = await fsp.readFile("build-tools/lang/defs_common.bzl", "utf8");
  const offenders = txt
    .split("\n")
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter(({ text }) => /^[A-Za-z_][A-Za-z0-9_]*_legacy_mutating\s*=/.test(text));

  assert.equal(
    offenders.length,
    0,
    [
      "build-tools/lang/defs_common.bzl must not export *_legacy_mutating symbols.",
      "Removed mutating helpers must remain out of the public //build-tools/lang surface.",
      "",
      ...offenders.map((o) => `- L${o.line}: ${o.text}`),
    ].join("\n"),
  );
});

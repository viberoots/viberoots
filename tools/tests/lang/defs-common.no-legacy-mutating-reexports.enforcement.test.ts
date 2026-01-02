#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("//lang:defs_common.bzl must not re-export legacy mutating helpers", async () => {
  const txt = await fsp.readFile("lang/defs_common.bzl", "utf8");
  const offenders = txt
    .split("\n")
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter(({ text }) => /^[A-Za-z_][A-Za-z0-9_]*_legacy_mutating\s*=/.test(text));

  assert.equal(
    offenders.length,
    0,
    [
      "lang/defs_common.bzl must not export *_legacy_mutating symbols.",
      "Legacy helpers are migration-only and must remain under dedicated //lang compatibility files.",
      "",
      ...offenders.map((o) => `- L${o.line}: ${o.text}`),
    ].join("\n"),
  );
});

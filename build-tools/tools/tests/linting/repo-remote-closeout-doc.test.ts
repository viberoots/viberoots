#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("contributor naming conventions document rename closeout remote check", async () => {
  const doc = await fsp.readFile(
    buildToolPath(process.cwd(), "../docs/contributor-naming-conventions.md"),
    "utf8",
  );
  assert.match(doc, /git remote get-url github/);
  assert.match(doc, /git@github\.com:viberoots\/viberoots\.git/);
});

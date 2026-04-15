#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-modules-build reuses verified markers even when temp lockfiles are git-dirty", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/node-modules-build.ts", "utf8");
  if (!txt.includes("if (await hasFreshVerifiedMarker(lockfileRel)) return;")) {
    throw new Error(
      "node-modules-build.ts must skip update-pnpm-hash when the verified marker matches current lockfile contents",
    );
  }
  if (txt.includes("if (!dirty && (await hasFreshVerifiedMarker(lockfileRel))) return;")) {
    throw new Error(
      "node-modules-build.ts must not require a clean git lockfile before using a verified marker fast path",
    );
  }
});

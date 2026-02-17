#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash logs fixed and unfixed phase progress", async () => {
  const file = "build-tools/tools/dev/update-pnpm-hash.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("step=fixed-build")) {
    throw new Error("update-pnpm-hash.ts must log fixed-build phase");
  }
  if (!txt.includes("step=unfixed-build")) {
    throw new Error("update-pnpm-hash.ts must log unfixed-build phase");
  }
  if (!txt.includes("step=fixed-build-after-hash")) {
    throw new Error("update-pnpm-hash.ts must log fixed-build-after-hash phase");
  }
});

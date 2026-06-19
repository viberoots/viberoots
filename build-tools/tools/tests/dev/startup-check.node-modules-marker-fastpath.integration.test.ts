#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("startup check resolves root node_modules outPath from link-node marker first", async () => {
  const txt = await fsp.readFile("viberoots/build-tools/tools/dev/dev-build/startup.ts", "utf8");
  if (!txt.includes("node-modules-link.root.json")) {
    throw new Error("startup.ts must consult root node-modules link marker");
  }
  if (!txt.includes("tryNodeModulesOutFromMarker")) {
    throw new Error("startup.ts must implement marker fast-path helper");
  }
  if (!txt.includes('crypto.createHash("sha256")')) {
    throw new Error("startup.ts marker fast-path must validate lockfile hash");
  }
});

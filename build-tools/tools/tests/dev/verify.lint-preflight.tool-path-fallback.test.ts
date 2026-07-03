#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify lint preflight resolves formatter tools from devshell PATH", async () => {
  const source = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/lint-preflight.ts",
    "utf8",
  );
  if (!source.includes('from "../../lib/repo-node-bin"')) {
    throw new Error("lint preflight must use repo node-bin resolution");
  }
  if (!source.includes("return await resolveRepoNodeBin(root, name);")) {
    throw new Error("lint preflight must delegate node-bin lookup to the PATH-capable resolver");
  }
  if (!source.includes("and PATH")) {
    throw new Error("missing-tool message should mention the PATH fallback");
  }
  if (!source.includes('relPath === "viberoots"')) {
    throw new Error("lint preflight should ignore generated flake source links");
  }
  for (const scaffoldPath of ["README.md", "projects/AGENTS.md", "projects/config/shared.json"]) {
    if (!source.includes(`relPath === "${scaffoldPath}"`)) {
      throw new Error(`lint preflight should ignore bootstrap scaffold path ${scaffoldPath}`);
    }
  }
  if (!source.includes("only generated bootstrap scaffold files changed")) {
    throw new Error("lint preflight should skip when only bootstrap scaffold files changed");
  }
});

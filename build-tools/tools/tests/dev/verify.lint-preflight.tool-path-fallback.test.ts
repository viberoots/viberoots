#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify lint preflight resolves formatter tools from devshell PATH", async () => {
  const source = (
    await Promise.all(
      ["lint-preflight.ts", "lint-preflight-scope.ts", "lint-preflight-tools.ts"].map((file) =>
        fsp.readFile(`viberoots/build-tools/tools/dev/verify/${file}`, "utf8"),
      ),
    )
  ).join("\n");
  if (!source.includes('from "../../lib/repo-node-bin"')) {
    throw new Error("lint preflight must use repo node-bin resolution");
  }
  if (!source.includes("return await resolveRepoNodeBin(root, name, env);")) {
    throw new Error(
      "lint preflight must delegate node-bin lookup to the PATH- and ZX_TEST_NODE_MODULES_OUT-capable resolver",
    );
  }
  if (!source.includes("const binEnv = envWithZxNodeModules(opts.zxNodeModulesOut)")) {
    throw new Error("lint preflight must resolve formatter tools from stable verify node_modules");
  }
  if (!source.includes("spawnSync(") || !source.includes("runFormatter(")) {
    throw new Error(
      "lint preflight must execute formatter shims directly with canonical Node PATH authority",
    );
  }
  if (!source.includes("const canonicalNodeBin = path.dirname(process.execPath)")) {
    throw new Error("lint preflight must bind formatter shims to the validated Node executable");
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

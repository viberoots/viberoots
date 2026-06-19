#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go apply writes canonical patch under target-local dir (no glue)", async () => {
  await runInTemp("patch-go-apply-create", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "file.txt"), "A\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const wsOut = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} viberoots/build-tools/tools/bin/patch-pkg start go golang.org/x/net`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fs.outputFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} viberoots/build-tools/tools/bin/patch-pkg apply go --target //features/auth:service golang.org/x/net`;
    const patch = path.join(tmp, "features/auth/patches/go/golang.org__x__net@v0.24.0.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected patch file missing");
      process.exit(2);
    }
    // No provider glue assertions for Go in local mode (providers are Node-only)
  });
});

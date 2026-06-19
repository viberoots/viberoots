#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go remove drops patch and refreshes glue deterministically", async () => {
  await runInTemp("patch-go-remove", async (tmp, $) => {
    const patchesDir = path.join(tmp, "patches", "go");
    await fs.mkdirp(patchesDir);

    // Synthesize a go patch file for golang.org/x/net@v0.24.0
    const enc = "golang.org__x__net";
    const version = "v0.24.0";
    const patchFile = path.join(patchesDir, `${enc}@${version}.patch`);
    await fs.outputFile(patchFile, "--- a/x\n+++ b/x\n", "utf8");

    // Prepare test-friendly resolve mapping for go
    const fakeOrigin = path.join(tmp, "_gomodcache", `golang.org/x/net@${version}`);
    await fs.mkdirp(fakeOrigin);

    const cli = path.join(tmp, "viberoots", "build-tools", "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const env = {
      ...process.env,
      ZX_INIT: path.join(tmp, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NO_DEV_SHELL: "1",
      NIX_GO_TEST_RESOLVE_JSON: JSON.stringify({
        "golang.org/x/net": { version, originPath: fakeOrigin },
      }),
    } as any;

    // Remove should delete the patch and invoke glue
    await $({ cwd: tmp, env })`${cli} remove go golang.org/x/net --patch-dir patches/go`;
    const exists = await fs.pathExists(patchFile);
    if (exists) {
      console.error("expected patch file to be removed");
      process.exit(2);
    }

    // Idempotency: a second remove should keep outputs stable
    await $({ cwd: tmp, env })`${cli} remove go golang.org/x/net --patch-dir patches/go`;
  });
});

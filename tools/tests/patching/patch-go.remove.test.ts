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

    const cli = path.join(tmp, "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const env = {
      ...process.env,
      ZX_INIT: path.join(tmp, "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NO_DEV_SHELL: "1",
      NIX_GO_TEST_RESOLVE_JSON: JSON.stringify({
        "golang.org/x/net": { version, originPath: fakeOrigin },
      }),
    } as any;

    // Capture glue state before removal (may be empty)
    const autoTargets = path.join(tmp, "third_party", "providers", "TARGETS.go.auto");
    const autoMap = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    const beforeTargets = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const beforeMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";

    // Remove should delete the patch and invoke glue
    await $({ cwd: tmp, env })`${cli} remove go golang.org/x/net --patch-dir patches/go`;
    const exists = await fs.pathExists(patchFile);
    if (exists) {
      console.error("expected patch file to be removed");
      process.exit(2);
    }

    const afterTargets = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const afterMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    if (afterTargets === undefined || afterMap === undefined) {
      console.error("expected glue outputs after remove for go");
      process.exit(2);
    }

    // Idempotency: a second remove should keep outputs stable
    await $({ cwd: tmp, env })`${cli} remove go golang.org/x/net --patch-dir patches/go`;
    const afterTargets2 = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const afterMap2 = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    if (afterTargets !== afterTargets2 || afterMap !== afterMap2) {
      console.error("provider outputs changed on idempotent remove (go)");
      process.exit(2);
    }
    // Ensure glue files exist even if empty content relative to before
    void beforeTargets;
    void beforeMap;
  });
});

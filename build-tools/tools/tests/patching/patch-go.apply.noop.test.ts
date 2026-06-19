#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go apply is no-op when no changes", async () => {
  await runInTemp("patch-go-apply-noop", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };

    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} PATCH_GO_DEBUG=1 NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} viberoots/build-tools/tools/bin/patch-pkg start go golang.org/x/net`;

    const out = await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} PATCH_GO_DEBUG=1 NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} viberoots/build-tools/tools/bin/patch-pkg apply go --target //pkg/alpha:lib golang.org/x/net`;
    const outTxtAll = String(out.stdout || "") + String(out.stderr || "");
    if (!outTxtAll.includes("no changes; no-op")) {
      console.error("apply did not report no-op");
      console.error(
        "--- captured output start ---\n" + outTxtAll + "\n--- captured output end ---",
      );
      process.exit(2);
    }
    const patch = path.join(tmp, "pkg/alpha/patches/go/golang.org__x__net@v0.24.0.patch");
    if (await fs.pathExists(patch)) {
      console.error("unexpected patch file created for no-op apply");
      process.exit(2);
    }
  });
});

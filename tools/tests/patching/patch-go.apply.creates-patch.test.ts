#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go apply writes canonical patch and runs glue", async () => {
  await runInTemp("patch-go-apply-create", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "file.txt"), "A\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };
    await $`chmod +x tools/bin/patch-pkg`;
    const wsOut = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg start go golang.org/x/net`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fs.outputFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg apply go golang.org/x/net`;
    const patch = path.join(tmp, "patches/go/golang.org__x__net@v0.24.0.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected patch file missing");
      process.exit(2);
    }

    // Glue generation should run; sync-providers writes third_party/providers/TARGETS.auto
    const prov = path.join(tmp, "third_party/providers/TARGETS.auto");
    if (!(await fs.pathExists(prov))) {
      console.error("expected providers TARGETS.auto missing");
      process.exit(2);
    }
    const autoMap = path.join(tmp, "third_party/providers/auto_map.bzl");
    if (!(await fs.pathExists(autoMap))) {
      console.error("expected auto_map.bzl missing");
      process.exit(2);
    }
  });
});

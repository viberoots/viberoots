#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-pkg prints patch model one-liner for package-local languages (go)", async () => {
  await runInTemp("patch-pkg-contract-msg-go", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "file.txt"), "A\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };

    await $`chmod +x build-tools/tools/bin/patch-pkg`;

    const wsOut = await $({ cwd: tmp, stdio: "pipe" })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(tmp, "gomodcache")} build-tools/tools/bin/patch-pkg start go golang.org/x/net`;

    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fs.outputFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp, stdio: "pipe" })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(tmp, "gomodcache")} build-tools/tools/bin/patch-pkg apply go --target //features/auth:service golang.org/x/net`.nothrow();

    const all = String(out.stdout || "") + String(out.stderr || "");
    if (!all.includes("no glue refresh is required")) {
      console.error("expected standardized no-glue message missing");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});

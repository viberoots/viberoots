#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go start fails in CI when attempting to set dev overrides", async () => {
  await runInTemp("patch-go-start-ci-forbidden", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };
    await $`chmod +x tools/bin/patch-pkg`;
    const r = await $({
      cwd: tmp,
      stdio: "pipe",
    })`CI=true NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} GOMODCACHE=${path.join(tmp, "gomodcache")} tools/bin/patch-pkg start go golang.org/x/net`.nothrow();
    if ((r.exitCode || 0) === 0) {
      console.error("expected patch-go start to fail in CI when setting dev overrides");
      console.error("stdout:", String(r.stdout || ""));
      console.error("stderr:", String(r.stderr || ""));
      process.exit(2);
    }
  });
});

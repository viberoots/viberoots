#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go start --echo-snippet prints an export snippet", async () => {
  await runInTemp("patch-go-start-echo-snippet", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };
    await $`chmod +x build-tools/tools/bin/patch-pkg`;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} build-tools/tools/bin/patch-pkg start go golang.org/x/net --echo-snippet`;
    const full = [String(res.stdout || ""), String(res.stderr || "")].join("\n");
    if (!full.includes("export NIX_GO_DEV_OVERRIDE_JSON=")) {
      console.error("expected export snippet in output");
      console.error("--- output start ---\n" + full + "\n--- output end ---");
      process.exit(2);
    }
  });
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go: workspace parent dir is viberoots-patch-go", async () => {
  await runInTemp("patch-go-ws-prefix", async (tmp, $) => {
    // Prepare fake pristine source and resolver mapping
    const origin = path.join(tmp, "gomodcache", "golang.org", "x", "net@v0.24.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };

    await $`chmod +x build-tools/tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
    })`NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} build-tools/tools/bin/patch-pkg start go golang.org/x/net`;
    const ws = String(out.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws) {
      console.error("missing workspace path on stdout");
      process.exit(2);
    }
    const parent = path.basename(path.dirname(ws));
    if (parent !== "viberoots-patch-go") {
      console.error("unexpected workspace parent dir", { parent, ws });
      process.exit(2);
    }
  });
});

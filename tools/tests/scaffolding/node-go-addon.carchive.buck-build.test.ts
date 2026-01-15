#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node go-addon: scaffolded go TARGETS declares nix_go_carchive with labels", async () => {
  await runInTemp("node-go-addon-carchive-targets", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;
    // Skip lockfile generation: this test is about the Go TARGETS content, not Node lockfile production.
    await $`scaf new node go-addon demo --yes --skip-lockfile-gen`;

    const targetsPath = path.join(tmp, "libs", "demo-go", "TARGETS");
    const txt = await fsp.readFile(targetsPath, "utf8");
    if (!txt.includes("nix_go_carchive(")) {
      throw new Error("nix_go_carchive not declared in libs/demo-go/TARGETS");
    }
    if (!txt.includes('"lang:go"') || !txt.includes('"kind:carchive"')) {
      throw new Error("expected labels lang:go and kind:carchive in libs/demo-go/TARGETS");
    }
  });
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node go-addon: README documents quickstart and canonical links", async () => {
  await runInTemp("node-go-addon-readme-docs", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    // Skip lockfile generation: this test is about rendered docs, not lockfile production.
    await $`scaf new ts go-addon demo --yes --skip-lockfile-gen`;

    const readmePath = path.join(tmp, "projects", "libs", "demo", "README.md");
    const txt = await fsp.readFile(readmePath, "utf8");

    // Quick sanity checks on documented paths/links
    if (!txt.includes("native/demo_addon.node")) {
      throw new Error("README missing stable addon path note: native/demo_addon.node");
    }
    if (!txt.includes("node-golang-addon.md")) {
      throw new Error("README missing link to node-golang-addon.md");
    }
    if (!txt.includes("ADDON_PATH")) {
      throw new Error("README missing ADDON_PATH override documentation");
    }
  });
});

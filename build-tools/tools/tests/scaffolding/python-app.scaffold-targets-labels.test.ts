#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python app scaffold TARGETS relies on default lockfile label", async () => {
  await runInTemp("python-app-targets-labels", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pyapp";
    await $`scaf new python app ${name} --yes`;

    const targetsPath = path.join(tmp, "projects", "apps", name, "TARGETS");
    const txt = await fsp.readFile(targetsPath, "utf8");
    if (txt.includes("lockfile:")) {
      throw new Error("TARGETS should not include explicit lockfile labels");
    }
    if (!txt.includes("nix_python_binary(") || !txt.includes("nix_python_library(")) {
      throw new Error("TARGETS missing nix_python_* macros for app scaffold");
    }
  });
});

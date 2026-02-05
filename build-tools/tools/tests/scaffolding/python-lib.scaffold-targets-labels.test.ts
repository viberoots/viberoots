#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python lib scaffold TARGETS relies on default lockfile label", async () => {
  await runInTemp("python-lib-targets-labels", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pylib";
    await $`scaf new python lib ${name} --yes`;

    const targetsPath = path.join(tmp, "projects", "libs", name, "TARGETS");
    const txt = await fsp.readFile(targetsPath, "utf8");
    if (txt.includes("lockfile:")) {
      throw new Error("TARGETS should not include explicit lockfile labels");
    }
    if (!txt.includes("nix_python_library(") || !txt.includes("nix_python_test(")) {
      throw new Error("TARGETS missing nix_python_* macros for lib scaffold");
    }
  });
});

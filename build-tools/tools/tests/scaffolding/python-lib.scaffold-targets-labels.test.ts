#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python lib scaffold TARGETS has importer-scoped lockfile label", async () => {
  await runInTemp("python-lib-targets-labels", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pylib";
    await $`scaf new python lib ${name} --yes`;

    const targetsPath = path.join(tmp, "libs", name, "TARGETS");
    const txt = await fsp.readFile(targetsPath, "utf8");
    const expectLabel = `lockfile:libs/${name}/uv.lock#libs/${name}`;
    if (!txt.includes(expectLabel)) {
      throw new Error(`TARGETS missing importer-scoped lockfile label: ${expectLabel}`);
    }
    if (!txt.includes("nix_python_library(") || !txt.includes("nix_python_test(")) {
      throw new Error("TARGETS missing nix_python_* macros for lib scaffold");
    }
  });
});

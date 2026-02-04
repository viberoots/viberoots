#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python app scaffold TARGETS has importer-scoped lockfile label", async () => {
  await runInTemp("python-app-targets-labels", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`git init`;

    const name = "demo_pyapp";
    await $`scaf new python app ${name} --yes`;

    const targetsPath = path.join(tmp, "apps", name, "TARGETS");
    const txt = await fsp.readFile(targetsPath, "utf8");
    const expectLabel = `lockfile:apps/${name}/uv.lock#apps/${name}`;
    if (!txt.includes(expectLabel)) {
      throw new Error(`TARGETS missing importer-scoped lockfile label: ${expectLabel}`);
    }
    if (!txt.includes("nix_python_binary(") || !txt.includes("nix_python_library(")) {
      throw new Error("TARGETS missing nix_python_* macros for app scaffold");
    }
  });
});

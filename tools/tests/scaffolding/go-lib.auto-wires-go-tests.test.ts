#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: adding *_test.go auto-wires nix_go_test and runs", async () => {
  await runInTemp("lib-auto-tests", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // ensure git repo for glue scripts that use git
    await $`git init`;

    // Scaffold a Go library
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    // Ensure module tidy and gomod2nix lock to keep planner happy
    await $({ cwd: path.join(tmp, "libs", "demo-lib"), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/demo-lib`;
    await fsp.copyFile(
      path.join(tmp, "libs", "demo-lib", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Add a simple *_test.go inside pkg/** so nix_go_library's auto-test picks it up
    const pkgDir = path.join(tmp, "libs/demo-lib/pkg/demo-lib");
    await fsp.mkdir(pkgDir, { recursive: true });
    await fsp.writeFile(
      path.join(pkgDir, "demo-lib_test.go"),
      'package demopkg\nimport "testing"\nfunc TestIt(t *testing.T){}\n',
      "utf8",
    );

    // Glue and build prerequisites
    await $`tools/dev/install-deps.ts --glue-only`;

    // Run the test via Buck; platform is set by runInTemp's .buckconfig
    await $`buck2 test //libs/demo-lib:demo-lib_test`;
  });
});

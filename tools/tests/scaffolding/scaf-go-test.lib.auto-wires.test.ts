#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf go test: lib auto-wires *_test.go under pkg/**", async () => {
  await runInTemp("scaf-go-test-lib", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // Scaffold a Go library
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    // Ensure module tidy and gomod2nix
    await $({ cwd: path.join(tmp, "libs", "demo-lib"), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/demo-lib`;
    await fsp.copyFile(
      path.join(tmp, "libs", "demo-lib", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Use scaf to create a new test under pkg/**
    const testPath = path.join(tmp, "libs/demo-lib/pkg/demo-lib/extra_case_test.go");
    await $`scaf go test extra_case --path=${testPath}`;

    // Glue and test
    await $`tools/dev/install-deps.ts --glue-only`;
    await $`buck2 test --target-platforms prelude//platforms:default //libs/demo-lib:demo-lib_test`;
  });
});

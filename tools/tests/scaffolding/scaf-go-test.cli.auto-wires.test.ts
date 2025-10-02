#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf go test: app auto-wires *_test.go under cmd/<app>/**", async () => {
  await runInTemp("scaf-go-test-app", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // Scaffold a Go CLI app
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    // Ensure module tidy and gomod2nix
    await $({ cwd: path.join(tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Use scaf to create a new test under cmd/<app>/**
    const testPath = path.join(tmp, "apps/demo-cli/cmd/demo-cli/extra_case_test.go");
    await $`scaf go test extra_case --path=${testPath}`;

    // Glue and test
    await $`tools/dev/install-deps.ts --glue-only`;
    await $`buck2 test --target-platforms prelude//platforms:default //apps/demo-cli:demo-cli_test`;
  });
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: adding *_test.go auto-wires nix_go_test and runs", async () => {
  await runInTemp("go-lib-auto-tests", async (tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // minimal Buck config
    await $`bash -lc ${`set -euo pipefail
      : > .buckroot
      cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
      mkdir -p toolchains
      printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
    `}`;

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

    // Run the test via Buck; explicitly set target platforms for determinism
    await $`buck2 test --target-platforms prelude//platforms:default //libs/demo-lib:demo-lib_test`;
  });
});

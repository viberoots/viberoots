#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("provider wiring present only on affected target after patch", async () => {
  await runInTemp("scaf-prov-wiring", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
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
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
    // Initialize module before editing
    await $`/usr/bin/env bash --noprofile --norc -lc 'cd libs/demo-lib && test -f go.mod || go mod init example.com/demo-lib && go mod edit -require golang.org/x/text@v0.14.0 && go mod tidy'`;
    // Generate gomod2nix lock at repo root from the lib module
    await $({ cwd: _tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/demo-lib`;
    await fsp.copyFile(
      path.join(_tmp, "libs", "demo-lib", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );
    // Create a dummy patch for that module version
    await $`/usr/bin/env bash --noprofile --norc -lc 'mkdir -p patches/go && touch patches/go/golang.org__x__text@v0.14.0.patch'`;
    // Run glue and build via Nix graph-generator
    await $`tools/dev/install-deps.ts --glue-only`;
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: { WORKSPACE_ROOT: _tmp },
    })`nix build .#graph-generator --out-link ${outLinkName} --impure`;
    await $`test -f third_party/providers/auto_map.bzl`;
  });
});

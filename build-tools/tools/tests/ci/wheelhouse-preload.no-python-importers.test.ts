#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import path from "node:path";
import * as fsp from "node:fs/promises";
import { runInTemp } from "../lib/test-helpers";

async function writeMinimalBuckConfig(tmp: string) {
  await $({ cwd: tmp })`bash --noprofile --norc -c ${`set -euo pipefail
    printf '.\\n' > .buckroot
    cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
config = ./prelude
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbsource_stub

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbsource_stub
config = ./prelude

[build]
prelude = prelude
target_platforms = prelude//platforms:default
EOF
    mkdir -p toolchains
    printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig
  `}`;
}

test("wheelhouse-preload: no python importers → no-op and success", async () => {
  await runInTemp("wheelhouse-preload-no-py", async (tmp, $) => {
    await writeMinimalBuckConfig(tmp);
    // Ensure no Python importers exist
    await fsp.rm(path.join(tmp, "apps"), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(path.join(tmp, "libs"), { recursive: true, force: true }).catch(() => {});
    // Run stage; should no-op successfully
    const rc = await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env },
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/ci/run-stage.ts --stage wheelhouse-preload`.nothrow();
    if (rc.exitCode !== 0) {
      console.error("wheelhouse-preload stage failed unexpectedly without python importers");
      process.exit(2);
    }
  });
});

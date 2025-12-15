#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: verbose lists newest inputs and oldest outputs (capped)", async () => {
  await runInTemp("prebuild-verbose-io", async (tmp, $) => {
    // Buck mapping
    await $({ cwd: tmp })`bash --noprofile --norc -c ${`set -euo pipefail
      printf '.\n' > .buckroot
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
    // Outputs
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "[]", "utf8");
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# gen\n",
      "utf8",
    );
    // Inputs (multiple) to populate top-N lists
    await fsp.writeFile(path.join(tmp, "TARGETS"), "# t1\n", "utf8");
    await fsp.mkdir(path.join(tmp, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "patches", "go", "example.com__mod@v0.0.9.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );
    // Run verbose with limit 2
    const { stdout, stderr } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, PREBUILD_GUARD_VERBOSE: "1", PREBUILD_GUARD_LIST_LIMIT: "2" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts --verbose --verbose-limit 2`;
    const out = String(stdout || "") + String(stderr || "");
    if (
      !out.includes("newer input:") &&
      !out.includes("older output:") &&
      !out.includes("missing output:")
    ) {
      console.error(out);
      throw new Error("expected verbose listings");
    }
  });
});

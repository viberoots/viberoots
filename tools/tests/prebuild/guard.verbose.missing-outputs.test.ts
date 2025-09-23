#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: verbose shows missing outputs", async () => {
  await runInTemp("prebuild-verbose-missing", async (tmp, $) => {
    // Create a patch to require provider autos
    await fsp.mkdir(path.join(tmp, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "patches", "go", "example.com__mod@v0.0.1.patch"),
      "diff --git a/b b\n",
      "utf8",
    );
    // Buck mapping
    await $({ cwd: tmp })`bash -lc ${`set -euo pipefail
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
    // Ensure outputs are absent
    const providersDir = path.join(tmp, "third_party", "providers");
    try {
      const entries = await fsp.readdir(providersDir);
      for (const name of entries) {
        if (/^TARGETS.*\.auto$/.test(name) || name === "auto_map.bzl") {
          try {
            await fsp.rm(path.join(providersDir, name));
          } catch {}
        }
      }
    } catch {}
    try {
      await fsp.rm(path.join(tmp, "tools", "buck", "graph.json"));
    } catch {}
    const { stdout, stderr } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, PREBUILD_GUARD_VERBOSE: "1", PREBUILD_GUARD_NO_FIX: "1" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts --verbose`;
    const out = String(stdout || "") + String(stderr || "");
    if (!out.includes("missing output:")) {
      console.error(out);
      throw new Error("expected missing outputs listed in verbose mode");
    }
  });
});

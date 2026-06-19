#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: --json emits structured diagnostics", async () => {
  await runInTemp("prebuild-json", async (tmp, $) => {
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
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
      "[]",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
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
    // One input
    await fsp.writeFile(path.join(tmp, "TARGETS"), "# t1\n", "utf8");
    // Capture JSON
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts --json --verbose-limit 1`;
    const txt = String(stdout || "");
    const first = txt.indexOf("{");
    const last = txt.lastIndexOf("}");
    const jsonSlice = first >= 0 && last >= first ? txt.slice(first, last + 1) : "{}";
    const obj = JSON.parse(jsonSlice);
    if (!obj || typeof obj !== "object") throw new Error("json missing");
    if (!Array.isArray(obj.inputsNewest)) throw new Error("inputsNewest missing");
    if (!Array.isArray(obj.outputsOldest)) throw new Error("outputsOldest missing");
    if (!obj.summary || typeof obj.summary !== "object") throw new Error("summary missing");
  });
});

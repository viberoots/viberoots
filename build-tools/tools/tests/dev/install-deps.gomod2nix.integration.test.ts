#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { withGoModuleInputFingerprint } from "../../dev/install/go-consistency";
import { runInTemp } from "../lib/test-helpers";

test("install-deps glue-only keeps tracked Go metadata and absence cache read-only", async () => {
  await runInTemp("install-deps-integration", async (tmp, $) => {
    await $`bash --noprofile --norc -c ${`set -euo pipefail
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
    const goMod = ["module example.com/demo", "\ngo 1.22"].join("\n");
    await fsp.writeFile(path.join(tmp, "go.mod"), goMod, "utf8");
    await fsp.writeFile(path.join(tmp, "go.sum"), "", "utf8");
    await fsp.writeFile(
      path.join(tmp, "gomod2nix.toml"),
      await withGoModuleInputFingerprint(tmp, "schema = 3\n\n[mod]\n"),
      "utf8",
    );
    const tracked = ["go.mod", "go.sum", "gomod2nix.toml"];
    const before = await Promise.all(tracked.map((file) => fsp.readFile(path.join(tmp, file))));
    await fsp.rm(path.join(tmp, ".viberoots/workspace/install-cache"), {
      recursive: true,
      force: true,
    });
    const env = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
    } as any;
    await $({
      cwd: tmp,
      stdio: "inherit",
      env,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs ./viberoots/build-tools/tools/dev/install-deps.ts --glue-only --skip-glue --skip-go-tidy --verbose`;
    const after = await Promise.all(tracked.map((file) => fsp.readFile(path.join(tmp, file))));
    assert.deepEqual(after, before);
    await assert.rejects(
      fsp.access(path.join(tmp, ".viberoots/workspace/install-cache/gomod2nix-root-absent.json")),
    );
    await assert.rejects(
      fsp.access(path.join(tmp, ".viberoots/workspace/install-cache/gomod2nix-absent.json")),
    );
    await fsp.appendFile(path.join(tmp, "go.sum"), "changed\n");
    const stale = await fsp.readFile(path.join(tmp, "go.sum"));
    await assert.rejects(
      $({
        cwd: tmp,
        stdio: "pipe",
        env,
      })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs ./viberoots/build-tools/tools/dev/install-deps.ts --glue-only --skip-glue --skip-go-tidy`,
      /tracked metadata is stale/,
    );
    assert.deepEqual(await fsp.readFile(path.join(tmp, "go.sum")), stale);
    for (const cache of ["gomod2nix-root-absent.json", "gomod2nix-absent.json"]) {
      await assert.rejects(fsp.access(path.join(tmp, ".viberoots/workspace/install-cache", cache)));
    }
  });
});

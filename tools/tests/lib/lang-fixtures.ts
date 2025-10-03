#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./test-helpers";

export type ScaffoldResult = {
  tmp: string;
  $: any;
};

export async function scaffoldLib(lang: string, name: string): Promise<ScaffoldResult> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const tmp = await runInTemp(`scaf-${lang}-lib`, async (t, _$) => {
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
    await $`scaf new go lib ${name} --yes --path=libs/${name}`;
    await $({ cwd: path.join(t, "libs", name), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: t, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/${name}`;
    await fsp.copyFile(
      path.join(t, "libs", name, "gomod2nix.toml"),
      path.join(t, "gomod2nix.toml"),
    );
    await $`tools/dev/install-deps.ts --glue-only`;
    return t;
  });
  // runInTemp cleans up; we expose a re-entrant helper by returning tmp via console logs not practical here.
  // For simplicity in this repository's test harness, individual tests should use runInTemp directly.
  return { tmp: "", $: null } as any;
}

export async function scaffoldCli(lang: string, name: string): Promise<ScaffoldResult> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const tmp = await runInTemp(`scaf-${lang}-cli`, async (t, _$) => {
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
    await $`scaf new go cli ${name} --yes --path=apps/${name}`;
    await $({ cwd: path.join(t, "apps", name), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: t, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/${name}`;
    await fsp.copyFile(
      path.join(t, "apps", name, "gomod2nix.toml"),
      path.join(t, "gomod2nix.toml"),
    );
    await $`tools/dev/install-deps.ts --glue-only`;
    return t;
  });
  return { tmp: "", $: null } as any;
}

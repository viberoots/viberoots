#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type TestCtx = { tmp: string; $: any };

export async function scaffoldLib(lang: string, name: string, ctx: TestCtx): Promise<void> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  await $`bash -lc ${`set -euo pipefail
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
  await $`scaf new go lib ${name} --yes --path=libs/${name}`;
  await $({ cwd: path.join(t, "libs", name), stdio: "inherit" })`go mod tidy`;
  await $({ cwd: t, stdio: "inherit" })`tools/bin/gomod2nix --dir libs/${name}`;
  await fsp.copyFile(path.join(t, "libs", name, "gomod2nix.toml"), path.join(t, "gomod2nix.toml"));
  await $`tools/dev/install-deps.ts --glue-only`;
}

export async function scaffoldApp(lang: string, name: string, ctx: TestCtx): Promise<void> {
  if (lang !== "go") throw new Error(`unsupported lang: ${lang}`);
  const { tmp: t, $ } = ctx;
  await $`bash -lc ${`set -euo pipefail
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
  await $`scaf new go cli ${name} --yes --path=apps/${name}`;
  await $({ cwd: path.join(t, "apps", name), stdio: "inherit" })`go mod tidy`;
  await $({ cwd: t, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/${name}`;
  await fsp.copyFile(path.join(t, "apps", name, "gomod2nix.toml"), path.join(t, "gomod2nix.toml"));
  await $`tools/dev/install-deps.ts --glue-only`;
}
